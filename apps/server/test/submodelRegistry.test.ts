import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { afterEach, describe, expect, it } from "vitest";
import { SEITE_VORGABE } from "../src/routen/shells.js";
import { PRUEF_BASIS, PRUEF_KENNUNG, pruefstand, roheAnfrage, type Aufruf, type Pruefstand } from "./hilfe.js";

const AAS_BASIS = "https://viewer-rc.test.dti.neoception.dev";
const OBEN = "https://oben.beispiel.test";
const GEMEINSAM = "https://example.com/sm/Gemeinsam";

let stand: Pruefstand | undefined;

afterEach(() => {
  stand?.schliessen();
  stand = undefined;
});

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function smId(itemId: string, name: string): string {
  return `${AAS_BASIS}/at/sm/${name}?itemId=${itemId}`;
}

function gefragteItemId(aufruf: Aufruf): string | null {
  const praefix = `${OBEN}/shells/`;
  if (!aufruf.url.startsWith(praefix)) return null;
  return new URL(Buffer.from(aufruf.url.slice(praefix.length), "base64url").toString("utf8")).searchParams.get(
    "itemId",
  );
}

/** Jede Schale verweist auf zwei eigene Teilmodelle und eines, das alle teilen. */
function schaleFuer(itemId: string): Record<string, unknown> {
  const verweis = (wert: string, semantik?: string): Record<string, unknown> => ({
    type: "ModelReference",
    ...(semantik ? { referredSemanticId: { type: "ExternalReference", keys: [{ type: "GlobalReference", value: semantik }] } } : {}),
    keys: [{ type: "Submodel", value: wert }],
  });
  return {
    id: `${AAS_BASIS}/at/aas?itemId=${itemId}`,
    submodels: [
      verweis(smId(itemId, "Nameplate"), "https://admin-shell.io/idta/nameplate/3/0/Nameplate"),
      verweis(smId(itemId, "Doku")),
      verweis(GEMEINSAM),
      // Kein Teilmodell-Verweis: faellt weg.
      { type: "ModelReference", keys: [{ type: "ConceptDescription", value: "urn:cd" }] },
    ],
  };
}

function obenMit(ausnahmen: Record<string, () => Response> = {}): (aufruf: Aufruf) => Response {
  return (aufruf) => {
    const itemId = gefragteItemId(aufruf);
    if (itemId === null) return new Response("{}", { status: 404 });
    const ausnahme = ausnahmen[itemId];
    if (ausnahme) return ausnahme();
    return Response.json(schaleFuer(itemId));
  };
}

function anlegen(itemIds: string[], antwort: (aufruf: Aufruf) => Response = obenMit()): Pruefstand {
  stand = pruefstand(antwort);
  stand.proxys.aendern(PRUEF_KENNUNG, { submodelRegistryAktiv: true });
  stand.proxys.itemIdsSetzen(PRUEF_KENNUNG, itemIds);
  return stand;
}

interface Descriptor {
  id: string;
  semanticId?: unknown;
  endpoints: { interface: string; protocolInformation: { href: string } }[];
}

interface Antwort {
  status: number;
  koerper: { paging_metadata?: { cursor?: string }; result?: Descriptor[]; messages?: { text: string }[] } & Partial<Descriptor>;
}

async function abrufen(rest: string): Promise<Antwort> {
  const antwort = await roheAnfrage(stand!.app, PRUEF_BASIS + rest);
  return { status: antwort.status, koerper: JSON.parse(antwort.koerper) as Antwort["koerper"] };
}

function ids(antwort: Antwort): string[] {
  return (antwort.koerper.result ?? []).map((descriptor) => descriptor.id);
}

const hier = path.dirname(fileURLToPath(import.meta.url));
const idta = JSON.parse(readFileSync(path.join(hier, "../spec/registry-schemas.json"), "utf8")) as {
  definitions: Record<string, unknown>;
};
const ajv = new Ajv({ strict: false, unicodeRegExp: false });
ajv.addSchema({ $id: "idta", definitions: idta.definitions });
const descriptorPruefen = ajv.compile({ $ref: "idta#/definitions/SubmodelDescriptor" });
const listePruefen = ajv.compile({ $ref: "idta#/definitions/GetSubmodelDescriptorsResult" });

describe("GET /submodel-descriptors", () => {
  it("liefert die Teilmodelle in Reihenfolge Schale und Verweis, das geteilte nur einmal, schemagerecht", async () => {
    anlegen(["A", "B"]);
    const antwort = await abrufen("/submodel-descriptors");
    expect(antwort.status).toBe(200);
    expect(ids(antwort)).toEqual([
      smId("A", "Nameplate"),
      smId("A", "Doku"),
      GEMEINSAM,
      smId("B", "Nameplate"),
      smId("B", "Doku"),
    ]);
    expect(listePruefen(antwort.koerper), JSON.stringify(listePruefen.errors)).toBe(true);
    const erstes = antwort.koerper.result![0]!;
    expect(erstes.semanticId).toMatchObject({ type: "ExternalReference" });
    expect(erstes.endpoints[0]).toMatchObject({ interface: "SUBMODEL-3.0" });
    expect(erstes.endpoints[0]!.protocolInformation.href).toMatch(
      new RegExp(`^http://127\\.0\\.0\\.1:\\d+/p/eins/submodels/${b64(smId("A", "Nameplate"))}$`),
    );
    expect(antwort.koerper.result![1]!.semanticId).toBeUndefined();
  });

  it("blaettert mit limit und cursor", async () => {
    anlegen(["A", "B"]);
    const erste = await abrufen("/submodel-descriptors?limit=3");
    expect(ids(erste)).toEqual([smId("A", "Nameplate"), smId("A", "Doku"), GEMEINSAM]);
    const zweite = await abrufen(`/submodel-descriptors?limit=3&cursor=${erste.koerper.paging_metadata!.cursor!}`);
    expect(ids(zweite)).toEqual([smId("B", "Nameplate"), smId("B", "Doku")]);
    expect(zweite.koerper.paging_metadata).toEqual({});
  });

  it(`gibt ohne limit hoechstens ${SEITE_VORGABE} aus`, async () => {
    anlegen(Array.from({ length: 60 }, (_, nummer) => `I${nummer}`));
    const antwort = await abrufen("/submodel-descriptors");
    expect(antwort.koerper.result).toHaveLength(SEITE_VORGABE);
    expect(antwort.koerper.paging_metadata?.cursor).toBeDefined();
  });

  it("weist kaputtes limit und cursor mit 400 ab", async () => {
    anlegen(["A"]);
    expect((await abrufen("/submodel-descriptors?limit=0")).status).toBe(400);
    expect((await abrufen("/submodel-descriptors?cursor=!!!")).status).toBe(400);
  });

  it("laesst Schalen weg, die es oben nicht gibt", async () => {
    anlegen(["A", "FEHLT"], obenMit({ FEHLT: () => new Response("{}", { status: 404 }) }));
    expect(ids(await abrufen("/submodel-descriptors"))).toEqual([smId("A", "Nameplate"), smId("A", "Doku"), GEMEINSAM]);
  });

  it("reicht 401 durch und antwortet bei 500 mit 502", async () => {
    anlegen(["A"], obenMit({ A: () => new Response('{"e":1}', { status: 401 }) }));
    expect((await abrufen("/submodel-descriptors")).status).toBe(401);
    stand!.schliessen();
    anlegen(["A"], obenMit({ A: () => new Response("x", { status: 500 }) }));
    expect((await abrufen("/submodel-descriptors")).status).toBe(502);
  });
});

describe("GET /submodel-descriptors/{submodelIdentifier}", () => {
  it("liefert den Descriptor eines registrierten Teilmodells, schemagerecht", async () => {
    anlegen(["A", "B"]);
    const antwort = await abrufen(`/submodel-descriptors/${b64(smId("B", "Doku"))}`);
    expect(antwort.status).toBe(200);
    expect(antwort.koerper.id).toBe(smId("B", "Doku"));
    expect(descriptorPruefen(antwort.koerper), JSON.stringify(descriptorPruefen.errors)).toBe(true);
  });

  it("findet auch ein geteiltes Teilmodell", async () => {
    anlegen(["A", "B"]);
    expect((await abrufen(`/submodel-descriptors/${b64(GEMEINSAM)}`)).status).toBe(200);
  });

  it("antwortet 404 fuer ein Teilmodell, auf das keine Schale verweist", async () => {
    anlegen(["A"]);
    const antwort = await abrufen(`/submodel-descriptors/${b64(smId("Z", "Nameplate"))}`);
    expect(antwort.status).toBe(404);
    expect(antwort.koerper.messages![0]!.text).toContain("is registered");
  });

  it("weist eine nicht kodierte Kennung mit 400 ab", async () => {
    anlegen(["A"]);
    expect((await abrufen("/submodel-descriptors/nicht!kodiert")).status).toBe(400);
  });
});

describe("Submodel Registry allgemein", () => {
  it("weist andere Methoden mit 405 ab", async () => {
    anlegen(["A"]);
    const antwort = await roheAnfrage(stand!.app, `${PRUEF_BASIS}/submodel-descriptors`, { methode: "POST" });
    expect(antwort.status).toBe(405);
    expect(antwort.kopfzeilen.allow).toBe("GET, HEAD");
  });

  it("ist ab Werk aus und ausgeschaltet nicht da, ohne oben zu fragen", async () => {
    stand = pruefstand(obenMit());
    stand.proxys.itemIdsSetzen(PRUEF_KENNUNG, ["A"]);
    expect((await abrufen("/submodel-descriptors")).status).toBe(404);
    expect((await abrufen(`/submodel-descriptors/${b64(GEMEINSAM)}`)).status).toBe(404);
    expect(stand.aufrufe).toHaveLength(0);
  });

  it("haengt nicht an den anderen Schaltern", async () => {
    anlegen(["A"]);
    expect((await roheAnfrage(stand!.app, `${PRUEF_BASIS}/shells`)).status).toBe(404);
    expect((await roheAnfrage(stand!.app, `${PRUEF_BASIS}/shell-descriptors`)).status).toBe(404);
    expect((await abrufen("/submodel-descriptors")).status).toBe(200);
  });

  it("teilt den Bestand mit GET /shells und der AAS Registry", async () => {
    anlegen(["A"]);
    stand!.proxys.aendern(PRUEF_KENNUNG, { shellsAktiv: true, registryAktiv: true });
    await roheAnfrage(stand!.app, `${PRUEF_BASIS}/shells`);
    await abrufen("/submodel-descriptors");
    await roheAnfrage(stand!.app, `${PRUEF_BASIS}/shell-descriptors`);
    expect(stand!.aufrufe).toHaveLength(1);
  });

  it("bedient keine Unterwege", async () => {
    anlegen(["A"]);
    expect((await roheAnfrage(stand!.app, `${PRUEF_BASIS}/submodel-descriptors/${b64(GEMEINSAM)}/x`)).status).toBe(404);
  });
});
