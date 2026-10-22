import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { afterEach, describe, expect, it } from "vitest";
import { descriptorAus } from "../src/routen/registry.js";
import { SEITE_VORGABE } from "../src/routen/shells.js";
import { PRUEF_BASIS, PRUEF_KENNUNG, pruefstand, roheAnfrage, type Aufruf, type Pruefstand } from "./hilfe.js";

const AAS_BASIS = "https://viewer-rc.test.dti.neoception.dev";
const OBEN = "https://oben.beispiel.test";

let stand: Pruefstand | undefined;

afterEach(() => {
  stand?.schliessen();
  stand = undefined;
});

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function aasId(itemId: string): string {
  return `${AAS_BASIS}/aas?itemId=${encodeURIComponent(itemId)}`;
}

/** Wie das echte Zielsystem: die Schale meldet ihre Kennung mit /at/. */
function eigeneId(itemId: string): string {
  return `${AAS_BASIS}/at/aas?itemId=${encodeURIComponent(itemId)}`;
}

function gefragteItemId(aufruf: Aufruf): string | null {
  const praefix = `${OBEN}/shells/`;
  if (!aufruf.url.startsWith(praefix)) return null;
  const id = Buffer.from(aufruf.url.slice(praefix.length), "base64url").toString("utf8");
  return new URL(id).searchParams.get("itemId");
}

/** Eine Schale wie von rc, Typ-Assets erkennt man am Praefix T. */
function schaleFuer(itemId: string): Record<string, unknown> {
  return {
    modelType: "AssetAdministrationShell",
    id: eigeneId(itemId),
    idShort: "Base",
    assetInformation: {
      assetKind: itemId.startsWith("T") ? "Type" : "Instance",
      assetType: itemId.startsWith("T") ? "Pumpe" : "IRI",
      globalAssetId: `${AAS_BASIS}/${itemId}`,
    },
    submodels: [
      {
        type: "ModelReference",
        referredSemanticId: {
          type: "ExternalReference",
          keys: [{ type: "GlobalReference", value: "https://admin-shell.io/idta/CompanyData/1/0/CompanyData" }],
        },
        keys: [{ type: "Submodel", value: `${AAS_BASIS}/at/sm/CompanyData?itemId=${itemId}` }],
      },
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

function anlegen(itemIds: string[], antwort: (aufruf: Aufruf) => Response | Promise<Response> = obenMit()): Pruefstand {
  stand = pruefstand(antwort);
  stand.proxys.aendern(PRUEF_KENNUNG, { registryAktiv: true });
  const gesetzt = stand.proxys.itemIdsSetzen(PRUEF_KENNUNG, itemIds);
  if (gesetzt === null || "fehler" in gesetzt) throw new Error("Item-IDs nicht gesetzt");
  return stand;
}

interface Descriptor {
  id: string;
  assetKind?: string;
  endpoints: { interface: string; protocolInformation: { href: string } }[];
  submodelDescriptors?: { id: string; endpoints: { protocolInformation: { href: string } }[] }[];
}

interface Antwort {
  status: number;
  koerper: {
    paging_metadata?: { cursor?: string };
    result?: Descriptor[];
    messages?: { text: string }[];
  } & Partial<Descriptor>;
}

async function abrufen(rest: string, kopfzeilen: Record<string, string> = {}): Promise<Antwort> {
  const antwort = await roheAnfrage(stand!.app, PRUEF_BASIS + rest, { kopfzeilen });
  return { status: antwort.status, koerper: JSON.parse(antwort.koerper) as Antwort["koerper"] };
}

function itemIdsIn(antwort: Antwort): string[] {
  return (antwort.koerper.result ?? []).map((descriptor) => new URL(descriptor.id).searchParams.get("itemId") ?? "");
}

const hier = path.dirname(fileURLToPath(import.meta.url));
const idta = JSON.parse(readFileSync(path.join(hier, "../spec/registry-schemas.json"), "utf8")) as {
  definitions: Record<string, unknown>;
};
// Die IDTA-Muster arbeiten mit einzelnen Ersatzzeichen, das verkraftet nur
// ein RegExp ohne u-Schalter.
const ajv = new Ajv({ strict: false, unicodeRegExp: false });
ajv.addSchema({ $id: "idta", definitions: idta.definitions });
const descriptorPruefen = ajv.compile({ $ref: "idta#/definitions/AssetAdministrationShellDescriptor" });
const listePruefen = ajv.compile({ $ref: "idta#/definitions/GetAssetAdministrationShellDescriptorsResult" });

describe("descriptorAus", () => {
  const basis = "https://proxy.test/p/rc";

  it("setzt id, Felder der Schale und einen Endpunkt auf den Proxy", () => {
    const descriptor = descriptorAus(schaleFuer("A"), basis)!;
    expect(descriptor).toMatchObject({
      id: eigeneId("A"),
      idShort: "Base",
      assetKind: "Instance",
      assetType: "IRI",
      globalAssetId: `${AAS_BASIS}/A`,
    });
    expect(descriptor.endpoints).toEqual([
      {
        interface: "AAS-3.0",
        protocolInformation: {
          href: `${basis}/shells/${b64(eigeneId("A"))}`,
          endpointProtocol: "HTTPS",
          endpointProtocolVersion: ["1.1"],
        },
      },
    ]);
  });

  it("baut je Teilmodell einen SubmodelDescriptor mit semanticId", () => {
    const descriptor = descriptorAus(schaleFuer("A"), basis)! as unknown as Descriptor & {
      submodelDescriptors: { semanticId: unknown; endpoints: { interface: string }[] }[];
    };
    const teilmodellId = `${AAS_BASIS}/at/sm/CompanyData?itemId=A`;
    expect(descriptor.submodelDescriptors).toHaveLength(1);
    expect(descriptor.submodelDescriptors[0]).toMatchObject({
      id: teilmodellId,
      semanticId: { type: "ExternalReference" },
    });
    expect(descriptor.submodelDescriptors[0]!.endpoints[0]).toMatchObject({
      interface: "SUBMODEL-3.0",
      protocolInformation: { href: `${basis}/submodels/${b64(teilmodellId)}` },
    });
  });

  it("nimmt das Protokoll aus der Basis", () => {
    const descriptor = descriptorAus(schaleFuer("A"), "http://127.0.0.1:3000/p/rc")!;
    expect(JSON.stringify(descriptor.endpoints)).toContain('"endpointProtocol":"HTTP"');
  });

  it("laesst fehlende Felder weg", () => {
    const descriptor = descriptorAus({ id: "urn:x" }, basis)!;
    expect(Object.keys(descriptor).sort()).toEqual(["endpoints", "id"]);
  });

  it("gibt ohne Kennung null zurueck", () => {
    expect(descriptorAus({ idShort: "x" }, basis)).toBeNull();
    expect(descriptorAus("kaputt", basis)).toBeNull();
  });

  it("besteht das IDTA-Schema", () => {
    const descriptor = descriptorAus(schaleFuer("A"), basis);
    expect(descriptorPruefen(descriptor), JSON.stringify(descriptorPruefen.errors)).toBe(true);
    // Gegenprobe: ohne Endpunkt verstoesst er gegen minItems.
    expect(descriptorPruefen({ ...descriptor, endpoints: [] })).toBe(false);
  });
});

describe("GET /shell-descriptors", () => {
  it("liefert die Descriptoren in der Reihenfolge der Liste, schemagerecht", async () => {
    anlegen(["C", "A", "B"]);
    const antwort = await abrufen("/shell-descriptors");
    expect(antwort.status).toBe(200);
    expect(itemIdsIn(antwort)).toEqual(["C", "A", "B"]);
    expect(listePruefen(antwort.koerper), JSON.stringify(listePruefen.errors)).toBe(true);
    expect(antwort.koerper.result![0]!.endpoints[0]!.protocolInformation.href).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/p\/eins\/shells\//,
    );
  });

  it("blaettert mit limit und cursor und holt ohne Filter nur die Seite", async () => {
    anlegen(["A", "B", "C"]);
    const erste = await abrufen("/shell-descriptors?limit=2");
    expect(itemIdsIn(erste)).toEqual(["A", "B"]);
    expect(stand!.aufrufe).toHaveLength(2);
    const zweite = await abrufen(`/shell-descriptors?limit=2&cursor=${erste.koerper.paging_metadata!.cursor!}`);
    expect(itemIdsIn(zweite)).toEqual(["C"]);
    expect(zweite.koerper.paging_metadata).toEqual({});
  });

  it(`gibt ohne limit hoechstens ${SEITE_VORGABE} Descriptoren aus`, async () => {
    anlegen(Array.from({ length: SEITE_VORGABE + 3 }, (_, nummer) => `I${nummer}`));
    const antwort = await abrufen("/shell-descriptors");
    expect(antwort.koerper.result).toHaveLength(SEITE_VORGABE);
    expect(antwort.koerper.paging_metadata?.cursor).toBeDefined();
  });

  it("filtert nach assetKind ueber alle Schalen und blaettert danach", async () => {
    anlegen(["A", "T1", "B", "T2", "T3"]);
    const erste = await abrufen("/shell-descriptors?assetKind=Type&limit=2");
    expect(itemIdsIn(erste)).toEqual(["T1", "T2"]);
    expect(stand!.aufrufe).toHaveLength(5);
    const zweite = await abrufen(
      `/shell-descriptors?assetKind=Type&limit=2&cursor=${erste.koerper.paging_metadata!.cursor!}`,
    );
    expect(itemIdsIn(zweite)).toEqual(["T3"]);
    expect(itemIdsIn(await abrufen("/shell-descriptors?assetKind=Instance"))).toEqual(["A", "B"]);
    expect(itemIdsIn(await abrufen("/shell-descriptors?assetKind=Role"))).toEqual([]);
  });

  it("filtert nach assetType", async () => {
    anlegen(["A", "T1"]);
    expect(itemIdsIn(await abrufen(`/shell-descriptors?assetType=${b64("Pumpe")}`))).toEqual(["T1"]);
    expect(itemIdsIn(await abrufen(`/shell-descriptors?assetType=${b64("IRI")}`))).toEqual(["A"]);
  });

  it("weist kaputte Parameter mit 400 ab, ohne oben zu fragen", async () => {
    anlegen(["A"]);
    for (const zusatz of ["?assetKind=Typ", "?assetType=!!!", "?limit=0", "?cursor=!!!"]) {
      expect((await abrufen(`/shell-descriptors${zusatz}`)).status, zusatz).toBe(400);
    }
    expect(stand!.aufrufe).toHaveLength(0);
  });

  it("laesst eine Schale weg, die es oben nicht gibt", async () => {
    anlegen(["A", "FEHLT"], obenMit({ FEHLT: () => new Response("{}", { status: 404 }) }));
    expect(itemIdsIn(await abrufen("/shell-descriptors"))).toEqual(["A"]);
  });

  it("reicht 401 durch und antwortet bei 500 mit 502", async () => {
    anlegen(["A"], obenMit({ A: () => new Response('{"e":1}', { status: 401 }) }));
    expect((await abrufen("/shell-descriptors")).status).toBe(401);
    stand!.schliessen();
    anlegen(["A"], obenMit({ A: () => new Response("x", { status: 500 }) }));
    expect((await abrufen("/shell-descriptors")).status).toBe(502);
  });
});

describe("GET /shell-descriptors/{aasIdentifier}", () => {
  it("liefert den Descriptor zur erzeugten Kennung, schemagerecht", async () => {
    anlegen(["A", "B"]);
    const antwort = await abrufen(`/shell-descriptors/${b64(aasId("B"))}`);
    expect(antwort.status).toBe(200);
    expect(antwort.koerper.id).toBe(eigeneId("B"));
    expect(descriptorPruefen(antwort.koerper), JSON.stringify(descriptorPruefen.errors)).toBe(true);
    expect(stand!.aufrufe).toHaveLength(1);
  });

  it("findet ihn auch unter der Kennung, die die Schale selbst meldet", async () => {
    anlegen(["A"]);
    expect((await abrufen(`/shell-descriptors/${b64(eigeneId("A"))}`)).status).toBe(200);
  });

  it("nimmt Auffuellzeichen hin, auch als %3D", async () => {
    anlegen(["AB"]);
    const gepolstert = Buffer.from(aasId("AB")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    expect(gepolstert.endsWith("=")).toBe(true);
    expect((await abrufen(`/shell-descriptors/${gepolstert}`)).status).toBe(200);
    expect((await abrufen(`/shell-descriptors/${gepolstert.replace(/=/g, "%3D")}`)).status).toBe(200);
  });

  it("antwortet 404 ohne Aufruf oben, wenn die itemID nicht in der Liste steht", async () => {
    anlegen(["A"]);
    const antwort = await abrufen(`/shell-descriptors/${b64(aasId("Z"))}`);
    expect(antwort.status).toBe(404);
    expect(antwort.koerper.messages![0]!.text).toContain("is registered");
    expect(stand!.aufrufe).toHaveLength(0);
  });

  it("antwortet 404 fuer eine fremde Basis mit passender itemID", async () => {
    anlegen(["A"]);
    expect((await abrufen(`/shell-descriptors/${b64("https://fremd.test/aas?itemId=A")}`)).status).toBe(404);
  });

  it("antwortet 404, wenn die Schale oben fehlt", async () => {
    anlegen(["A"], obenMit({ A: () => new Response("{}", { status: 404 }) }));
    expect((await abrufen(`/shell-descriptors/${b64(aasId("A"))}`)).status).toBe(404);
  });

  it("reicht 401 durch und antwortet bei 500 mit 502", async () => {
    anlegen(["A"], obenMit({ A: () => new Response("{}", { status: 403 }) }));
    expect((await abrufen(`/shell-descriptors/${b64(aasId("A"))}`)).status).toBe(403);
    stand!.schliessen();
    anlegen(["A"], obenMit({ A: () => new Response("x", { status: 500 }) }));
    expect((await abrufen(`/shell-descriptors/${b64(aasId("A"))}`)).status).toBe(502);
  });

  it("weist eine nicht kodierte Kennung mit 400 ab", async () => {
    anlegen(["A"]);
    expect((await abrufen("/shell-descriptors/nicht!kodiert")).status).toBe(400);
  });

  it("bedient Unterwege nicht", async () => {
    anlegen(["A"]);
    const antwort = await roheAnfrage(stand!.app, `${PRUEF_BASIS}/shell-descriptors/${b64(aasId("A"))}/submodel-descriptors`);
    expect(antwort.status).toBe(404);
    expect(stand!.aufrufe).toHaveLength(0);
  });
});

describe("Registry allgemein", () => {
  it("weist andere Methoden mit 405 ab", async () => {
    anlegen(["A"]);
    const antwort = await roheAnfrage(stand!.app, `${PRUEF_BASIS}/shell-descriptors`, { methode: "POST" });
    expect(antwort.status).toBe(405);
    expect(antwort.kopfzeilen.allow).toBe("GET, HEAD");
  });

  it("ist ab Werk aus und ausgeschaltet nicht da, ohne oben zu fragen", async () => {
    stand = pruefstand(obenMit());
    stand.proxys.itemIdsSetzen(PRUEF_KENNUNG, ["A"]);
    expect((await abrufen("/shell-descriptors")).status).toBe(404);
    expect((await abrufen(`/shell-descriptors/${b64(aasId("A"))}`)).status).toBe(404);
    stand.proxys.aendern(PRUEF_KENNUNG, { registryAktiv: true });
    expect((await abrufen("/shell-descriptors")).status).toBe(200);
    stand.proxys.aendern(PRUEF_KENNUNG, { registryAktiv: false });
    expect((await abrufen("/shell-descriptors")).status).toBe(404);
    expect(stand.aufrufe).toHaveLength(1);
  });

  it("haengt nicht an GET /shells: jeder Schalter fuer sich", async () => {
    anlegen(["A"]);
    expect((await roheAnfrage(stand!.app, `${PRUEF_BASIS}/shells`)).status).toBe(404);
    expect((await abrufen("/shell-descriptors")).status).toBe(200);
  });

  it("teilt den Puffer mit GET /shells", async () => {
    anlegen(["A"]);
    stand!.proxys.aendern(PRUEF_KENNUNG, { shellsAktiv: true });
    await roheAnfrage(stand!.app, `${PRUEF_BASIS}/shells`);
    await abrufen("/shell-descriptors");
    await abrufen(`/shell-descriptors/${b64(aasId("A"))}`);
    expect(stand!.aufrufe).toHaveLength(1);
  });
});
