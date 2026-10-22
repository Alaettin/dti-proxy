import { afterEach, describe, expect, it } from "vitest";
import { SchalenPuffer } from "../src/puffer.js";
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

/** Die itemID, nach der oben gefragt wurde, oder null bei einem anderen Weg. */
function gefragteItemId(aufruf: Aufruf): string | null {
  const praefix = `${OBEN}/shells/`;
  if (!aufruf.url.startsWith(praefix)) return null;
  const id = Buffer.from(aufruf.url.slice(praefix.length), "base64url").toString("utf8");
  return new URL(id).searchParams.get("itemId");
}

/** Oben antwortet jede Schale mit sich selbst, ausser den genannten Ausnahmen. */
function obenMit(ausnahmen: Record<string, () => Response> = {}): (aufruf: Aufruf) => Response {
  return (aufruf) => {
    const itemId = gefragteItemId(aufruf);
    if (itemId === null) return new Response("{}", { status: 404 });
    const ausnahme = ausnahmen[itemId];
    if (ausnahme) return ausnahme();
    return Response.json({ modelType: "AssetAdministrationShell", id: aasId(itemId), idShort: itemId });
  };
}

function anlegen(
  itemIds: string[],
  antwort: (aufruf: Aufruf) => Response | Promise<Response> = obenMit(),
): Pruefstand {
  stand = pruefstand(antwort);
  // Ab Werk ist GET /shells aus; hier geht es um den eingeschalteten Weg.
  stand.proxys.aendern(PRUEF_KENNUNG, { shellsAktiv: true });
  const gesetzt = stand.proxys.itemIdsSetzen(PRUEF_KENNUNG, itemIds);
  if (gesetzt === null || "fehler" in gesetzt) throw new Error("Item-IDs nicht gesetzt");
  return stand;
}

interface Antwort {
  status: number;
  koerper: {
    paging_metadata?: { cursor?: string };
    result?: { id: string; idShort: string }[];
    messages?: { text: string; code: string }[];
  };
  kopfzeilen: Record<string, string | string[] | undefined>;
}

async function shells(zusatz = "", kopfzeilen: Record<string, string> = {}): Promise<Antwort> {
  const antwort = await roheAnfrage(stand!.app, PRUEF_BASIS + "/shells" + zusatz, { kopfzeilen });
  return { status: antwort.status, koerper: JSON.parse(antwort.koerper) as Antwort["koerper"], kopfzeilen: antwort.kopfzeilen };
}

function idShorts(antwort: Antwort): string[] {
  return (antwort.koerper.result ?? []).map((schale) => schale.idShort);
}

function assetId(name: string, value: string): string {
  return b64(JSON.stringify({ name, value }));
}

describe("GET /shells", () => {
  it("liefert bei leerer Liste 200 mit leerem result, ohne oben zu fragen", async () => {
    anlegen([]);
    const antwort = await shells();
    expect(antwort.status).toBe(200);
    expect(antwort.koerper).toEqual({ paging_metadata: {}, result: [] });
    expect(stand!.aufrufe).toHaveLength(0);
  });

  it("liefert die Schalen von oben in der Reihenfolge der Liste", async () => {
    anlegen(["C", "A", "B"]);
    const antwort = await shells();
    expect(antwort.status).toBe(200);
    expect(idShorts(antwort)).toEqual(["C", "A", "B"]);
    expect(antwort.koerper.result![0]!.id).toBe(aasId("C"));
  });

  it("fragt oben genau nach base64url(<aasBasis>/aas?itemId=<kodierte itemID>)", async () => {
    anlegen(["A B/1"]);
    await shells();
    expect(stand!.aufrufe.map((aufruf) => aufruf.url)).toEqual([
      `${OBEN}/shells/${b64(`${AAS_BASIS}/aas?itemId=A%20B%2F1`)}`,
    ]);
  });

  it("blaettert mit limit und cursor ueber mehrere Seiten", async () => {
    anlegen(["A", "B", "C", "D", "E"]);
    const erste = await shells("?limit=2");
    expect(idShorts(erste)).toEqual(["A", "B"]);
    const zweite = await shells(`?limit=2&cursor=${erste.koerper.paging_metadata!.cursor!}`);
    expect(idShorts(zweite)).toEqual(["C", "D"]);
    const dritte = await shells(`?limit=2&cursor=${zweite.koerper.paging_metadata!.cursor!}`);
    expect(idShorts(dritte)).toEqual(["E"]);
    expect(dritte.koerper.paging_metadata).toEqual({});
  });

  it(`gibt ohne limit hoechstens ${SEITE_VORGABE} Schalen aus`, async () => {
    anlegen(Array.from({ length: SEITE_VORGABE + 5 }, (_, nummer) => `I${nummer}`));
    const antwort = await shells();
    expect(antwort.koerper.result).toHaveLength(SEITE_VORGABE);
    expect(antwort.koerper.paging_metadata?.cursor).toBeDefined();
  });

  it("weist kaputtes limit und kaputten cursor mit 400 ab", async () => {
    anlegen(["A"]);
    expect((await shells("?limit=0")).status).toBe(400);
    expect((await shells("?limit=x")).status).toBe(400);
    expect((await shells("?cursor=!!!")).status).toBe(400);
    expect((await shells(`?cursor=${b64("abc")}`)).status).toBe(400);
    expect(stand!.aufrufe).toHaveLength(0);
  });

  describe("assetIds", () => {
    it("filtert auf die passende itemID", async () => {
      anlegen(["A", "B", "C"]);
      const antwort = await shells(`?assetIds=${assetId("globalAssetId", `${AAS_BASIS}/B`)}`);
      expect(idShorts(antwort)).toEqual(["B"]);
      expect(stand!.aufrufe).toHaveLength(1);
    });

    it("verknuepft mehrere Werte mit oder, die Reihenfolge der Liste bleibt", async () => {
      anlegen(["A", "B", "C"]);
      const antwort = await shells(
        `?assetIds=${assetId("globalAssetId", `${AAS_BASIS}/C`)}&assetIds=${assetId("globalAssetId", aasId("A"))}`,
      );
      expect(idShorts(antwort)).toEqual(["A", "C"]);
    });

    it("trifft mit einem anderen Namen nichts", async () => {
      anlegen(["A"]);
      const antwort = await shells(`?assetIds=${assetId("serialNumber", "A")}`);
      expect(antwort.status).toBe(200);
      expect(antwort.koerper.result).toEqual([]);
    });

    it("nimmt eine itemID, die nicht in der Liste steht, nicht auf", async () => {
      anlegen(["A"]);
      const antwort = await shells(`?assetIds=${assetId("globalAssetId", `${AAS_BASIS}/Z`)}`);
      expect(antwort.koerper.result).toEqual([]);
      expect(stand!.aufrufe).toHaveLength(0);
    });

    it("nimmt Auffuellzeichen hin", async () => {
      anlegen(["AB"]);
      const gepolstert = Buffer.from(JSON.stringify({ name: "globalAssetId", value: `${AAS_BASIS}/AB` })).toString(
        "base64",
      );
      const ohneSonderzeichen = gepolstert.replace(/\+/g, "-").replace(/\//g, "_");
      expect(idShorts(await shells(`?assetIds=${ohneSonderzeichen}`))).toEqual(["AB"]);
    });

    it("weist kaputte Werte mit 400 ab", async () => {
      anlegen(["A"]);
      expect((await shells("?assetIds=!!!")).status).toBe(400);
      expect((await shells(`?assetIds=${b64("kein json")}`)).status).toBe(400);
      expect((await shells(`?assetIds=${b64(JSON.stringify({ name: "globalAssetId" }))}`)).status).toBe(400);
      expect((await shells(`?assetIds=${b64("[]")}`)).status).toBe(400);
    });
  });

  it("laesst eine Schale weg, die es oben nicht gibt", async () => {
    anlegen(["A", "FEHLT", "B"], obenMit({ FEHLT: () => new Response("{}", { status: 404 }) }));
    expect(idShorts(await shells())).toEqual(["A", "B"]);
  });

  it("reicht 401 von oben unveraendert als Antwort durch", async () => {
    anlegen(
      ["A", "B"],
      obenMit({ B: () => new Response('{"error":"token"}', { status: 401, headers: { "content-type": "application/json" } }) }),
    );
    const antwort = await shells();
    expect(antwort.status).toBe(401);
    expect(antwort.koerper).toEqual({ error: "token" });
  });

  it("antwortet 502, wenn oben etwas anderes kommt", async () => {
    anlegen(["A"], obenMit({ A: () => new Response("kaputt", { status: 500 }) }));
    const antwort = await shells();
    expect(antwort.status).toBe(502);
    expect(antwort.koerper.messages![0]!.text).toContain("answered 500");
  });

  it("antwortet 502, wenn oben kein JSON kommt", async () => {
    anlegen(["A"], obenMit({ A: () => new Response("<html>", { status: 200 }) }));
    expect((await shells()).status).toBe(502);
  });

  it("antwortet 502, wenn oben die Zeit ablaeuft", async () => {
    anlegen(["A"], () => new Promise<Response>(() => {}));
    stand!.proxys.aendern(PRUEF_KENNUNG, { zeitlimitMs: 1000 });
    const antwort = await shells();
    expect(antwort.status).toBe(502);
    expect(antwort.koerper.messages![0]!.text).toContain("1000 ms");
  }, 10_000);

  it("reicht Authorization nach oben weiter", async () => {
    anlegen(["A"]);
    await shells("", { authorization: "Bearer abc" });
    expect(stand!.aufrufe[0]!.kopfzeilen.authorization).toBe("Bearer abc");
  });

  it("weist andere Methoden mit 405 ab", async () => {
    anlegen(["A"]);
    const antwort = await roheAnfrage(stand!.app, PRUEF_BASIS + "/shells", { methode: "POST" });
    expect(antwort.status).toBe(405);
    expect(antwort.kopfzeilen.allow).toBe("GET, HEAD");
  });

  it("bedient eine unbekannte Kennung nicht und fragt nicht oben", async () => {
    anlegen(["A"]);
    const antwort = await roheAnfrage(stand!.app, "/p/gibtsnicht/shells");
    expect(antwort.status).toBe(404);
    expect(stand!.aufrufe).toHaveLength(0);
  });

  it("bedient /shells/ mit Schraegstrich nicht selbst", async () => {
    anlegen(["A"]);
    const antwort = await roheAnfrage(stand!.app, PRUEF_BASIS + "/shells/");
    expect(antwort.status).toBe(404);
    expect(stand!.aufrufe).toHaveLength(0);
  });

  it("bedient den Weg nicht, wenn GET /shells ausgeschaltet ist", async () => {
    anlegen(["A"]);
    stand!.proxys.aendern(PRUEF_KENNUNG, { shellsAktiv: false });
    const antwort = await shells();
    expect(antwort.status).toBe(404);
    expect(antwort.koerper.messages![0]!.text).toContain("No route for GET");
    expect(stand!.aufrufe).toHaveLength(0);
  });

  it("ist ab Werk ausgeschaltet", async () => {
    stand = pruefstand(obenMit());
    stand.proxys.itemIdsSetzen(PRUEF_KENNUNG, ["A"]);
    expect((await shells()).status).toBe(404);
    expect(stand.aufrufe).toHaveLength(0);
  });

  it("laesst GET /shells/{id} weiter durch die Weiterleitung laufen", async () => {
    anlegen([], () => Response.json({ durchgereicht: true }));
    const antwort = await roheAnfrage(stand!.app, `${PRUEF_BASIS}/shells/${b64(aasId("A"))}`);
    expect(antwort.status).toBe(200);
    expect(JSON.parse(antwort.koerper)).toEqual({ durchgereicht: true });
  });
});

describe("Puffer von GET /shells", () => {
  it("fragt beim zweiten Aufruf nicht mehr oben", async () => {
    anlegen(["A", "B"]);
    await shells();
    await shells();
    expect(stand!.aufrufe).toHaveLength(2);
  });

  it("laesst Eintraege nicht einzeln verfallen, erst die Erneuerung tauscht sie aus", async () => {
    anlegen(["A"]);
    await shells();
    await shells();
    expect(stand!.aufrufe).toHaveLength(1);
    await stand!.erneuerer.anstossen(PRUEF_KENNUNG);
    expect(stand!.aufrufe).toHaveLength(2);
    await shells();
    expect(stand!.aufrufe).toHaveLength(2);
  });

  it("puffert auch eine fehlende Schale", async () => {
    anlegen(["FEHLT"], obenMit({ FEHLT: () => new Response("{}", { status: 404 }) }));
    await shells();
    await shells();
    expect(stand!.aufrufe).toHaveLength(1);
  });

  it("puffert keine Abweisung und keinen Fehler", async () => {
    let status = 401;
    anlegen(["A"], obenMit({ A: () => new Response("{}", { status }) }));
    expect((await shells()).status).toBe(401);
    status = 500;
    expect((await shells()).status).toBe(502);
    expect((await shells()).status).toBe(502);
    expect(stand!.aufrufe).toHaveLength(3);
  });

  it("gibt eine mit Token geholte Schale nicht an einen anderen Aufrufer", async () => {
    anlegen(["A"]);
    await shells("", { authorization: "Bearer eins" });
    await shells();
    await shells("", { authorization: "Bearer zwei" });
    await shells("", { authorization: "Bearer eins" });
    expect(stand!.aufrufe).toHaveLength(3);
  });

  it("ist mit Dauer 0 aus", async () => {
    anlegen(["A"]);
    stand!.proxys.aendern(PRUEF_KENNUNG, { pufferStunden: 0 });
    await shells();
    await shells();
    expect(stand!.aufrufe).toHaveLength(2);
  });

  it("teilt einen laufenden Abruf zwischen gleichzeitigen Anfragen", async () => {
    let freigeben: () => void = () => {};
    const gesperrt = new Promise<void>((fertig) => (freigeben = fertig));
    const oben = obenMit();
    anlegen(["A"], async (aufruf) => {
      await gesperrt;
      return oben(aufruf);
    });
    const beide = Promise.all([shells(), shells()]);
    // Beiden Anfragen Zeit geben, im Puffer anzukommen, bevor oben antwortet.
    await new Promise((fertig) => setTimeout(fertig, 100));
    freigeben();
    const [eins, zwei] = await beide;
    expect(idShorts(eins)).toEqual(["A"]);
    expect(idShorts(zwei)).toEqual(["A"]);
    expect(stand!.aufrufe).toHaveLength(1);
  });

  it("zaehlt nur fertige Eintraege und leert je Proxy", async () => {
    const puffer = new SchalenPuffer();
    await puffer.holen(1, "a", true, async () => "x", () => true);
    await puffer.holen(2, "a", true, async () => "y", () => true);
    expect(puffer.anzahl(1)).toBe(1);
    puffer.leeren(1);
    expect(puffer.anzahl(1)).toBe(0);
    expect(puffer.anzahl(2)).toBe(1);
  });
});
