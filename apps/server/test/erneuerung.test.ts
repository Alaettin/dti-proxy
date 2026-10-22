import { afterEach, describe, expect, it } from "vitest";
import { Erneuerer } from "../src/erneuerung.js";
import { PRUEF_BASIS, PRUEF_KENNUNG, pruefstand, roheAnfrage, type Aufruf, type Pruefstand } from "./hilfe.js";

const AAS_BASIS = "https://viewer-rc.test.dti.neoception.dev";
const OBEN = "https://oben.beispiel.test";
// Fest, nicht aus erneuerung.ts: sonst wanderte ein Fehler in der Einheit mit.
const STUNDE_MS = 60 * 60 * 1000;

let stand: Pruefstand | undefined;

afterEach(() => {
  stand?.erneuerer.stoppen();
  stand?.schliessen();
  stand = undefined;
});

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function gefragteItemId(aufruf: Aufruf): string | null {
  const praefix = `${OBEN}/shells/`;
  if (!aufruf.url.startsWith(praefix)) return null;
  return new URL(Buffer.from(aufruf.url.slice(praefix.length), "base64url").toString("utf8")).searchParams.get(
    "itemId",
  );
}

/** Eine Uhr zum Stellen und eine Gegenstelle, deren Antwort sich je itemID austauschen laesst. */
function aufbauen(itemIds: string[]): {
  vor: (ms: number) => void;
  antwort: Map<string, () => Response | Promise<Response>>;
} {
  let jetzt = Date.parse("2026-10-22T10:00:00.000Z");
  const antwort = new Map<string, () => Response | Promise<Response>>();
  stand = pruefstand(
    (aufruf) => {
      const itemId = gefragteItemId(aufruf);
      if (itemId === null) return new Response("{}", { status: 404 });
      const eigene = antwort.get(itemId);
      if (eigene) return eigene();
      return Response.json({
        id: `${AAS_BASIS}/at/aas?itemId=${itemId}`,
        idShort: "Base",
        submodels: [{ keys: [{ type: "Submodel", value: `${AAS_BASIS}/at/sm/X?itemId=${itemId}` }] }],
      });
    },
    { jetzt: () => jetzt },
  );
  stand.proxys.aendern(PRUEF_KENNUNG, { shellsAktiv: true, registryAktiv: true, submodelRegistryAktiv: true });
  stand.proxys.itemIdsSetzen(PRUEF_KENNUNG, itemIds);
  return { vor: (ms) => (jetzt += ms), antwort };
}

function proxyId(): number {
  return stand!.proxys.idVon(PRUEF_KENNUNG)!;
}

async function holen(rest: string, kopfzeilen: Record<string, string> = {}): Promise<number> {
  return (await roheAnfrage(stand!.app, PRUEF_BASIS + rest, { kopfzeilen })).status;
}

describe("Erneuerung im Hintergrund", () => {
  it("fuellt beim ersten Pruefen den Bestand, danach antworten alle Wege ohne Aufruf oben", async () => {
    aufbauen(["A", "B"]);
    await stand!.erneuerer.faelligePruefen();
    expect(stand!.aufrufe).toHaveLength(2);
    expect(await holen("/shells")).toBe(200);
    expect(await holen("/shell-descriptors")).toBe(200);
    expect(await holen(`/shell-descriptors/${b64(`${AAS_BASIS}/aas?itemId=A`)}`)).toBe(200);
    expect(await holen("/submodel-descriptors")).toBe(200);
    expect(await holen(`/submodel-descriptors/${b64(`${AAS_BASIS}/at/sm/X?itemId=B`)}`)).toBe(200);
    expect(stand!.aufrufe).toHaveLength(2);
  });

  it("ist erst nach Ablauf der Stunden wieder faellig, alle Schalen zugleich", async () => {
    const { vor } = aufbauen(["A", "B"]);
    stand!.proxys.aendern(PRUEF_KENNUNG, { pufferStunden: 2 });
    await stand!.erneuerer.faelligePruefen();
    vor(2 * STUNDE_MS - 1);
    await stand!.erneuerer.faelligePruefen();
    expect(stand!.aufrufe).toHaveLength(2);
    vor(1);
    await stand!.erneuerer.faelligePruefen();
    expect(stand!.aufrufe).toHaveLength(4);
    expect(stand!.erneuerer.stand(proxyId()).naechsteErneuerung).toBe(
      Date.parse("2026-10-22T10:00:00.000Z") + 4 * STUNDE_MS,
    );
  });

  it("rechnet 720 Stunden ohne Ueberlauf", async () => {
    const { vor } = aufbauen(["A"]);
    stand!.proxys.aendern(PRUEF_KENNUNG, { pufferStunden: 720 });
    await stand!.erneuerer.faelligePruefen();
    vor(719 * STUNDE_MS);
    await stand!.erneuerer.faelligePruefen();
    expect(stand!.aufrufe).toHaveLength(1);
    vor(STUNDE_MS);
    await stand!.erneuerer.faelligePruefen();
    expect(stand!.aufrufe).toHaveLength(2);
  });

  it("tauscht erst am Ende: waehrend der Erneuerung liefert der alte Bestand", async () => {
    const { antwort } = aufbauen(["A"]);
    await stand!.erneuerer.faelligePruefen();
    let freigeben: () => void = () => {};
    const gesperrt = new Promise<void>((fertig) => (freigeben = fertig));
    // Die Gegenstelle haelt die Erneuerung mitten im Lauf an.
    antwort.set("A", async () => {
      await gesperrt;
      return Response.json({ id: `${AAS_BASIS}/at/aas?itemId=A`, idShort: "Neu" });
    });
    const lauf = stand!.erneuerer.anstossen(PRUEF_KENNUNG);
    expect(stand!.erneuerer.stand(proxyId()).laeuft).toBe(true);
    const idShort = async (): Promise<string> =>
      (JSON.parse((await roheAnfrage(stand!.app, `${PRUEF_BASIS}/shells`)).koerper) as { result: { idShort: string }[] })
        .result[0]!.idShort;
    expect(await idShort()).toBe("Base");
    // Nur die Erneuerung selbst ging nach oben, der Aufruf kam aus dem alten Bestand.
    expect(stand!.aufrufe).toHaveLength(2);
    freigeben();
    await lauf;
    expect(await idShort()).toBe("Neu");
    expect(stand!.aufrufe).toHaveLength(2);
  });

  it("behaelt den alten Eintrag, wenn ein Abruf scheitert", async () => {
    const { antwort } = aufbauen(["A", "B"]);
    await stand!.erneuerer.faelligePruefen();
    antwort.set("A", () => new Response("kaputt", { status: 500 }));
    await stand!.erneuerer.anstossen(PRUEF_KENNUNG);
    expect(stand!.puffer.anzahl(proxyId())).toBe(2);
    const aufrufe = stand!.aufrufe.length;
    expect(await holen("/shells")).toBe(200);
    expect(stand!.aufrufe.length).toBe(aufrufe);
  });

  it("nimmt neue Items auf und laesst entfernte fallen", async () => {
    aufbauen(["A", "B"]);
    await stand!.erneuerer.faelligePruefen();
    stand!.proxys.itemIdsSetzen(PRUEF_KENNUNG, ["B", "C"]);
    await stand!.erneuerer.anstossen(PRUEF_KENNUNG);
    expect(stand!.puffer.anzahl(proxyId())).toBe(2);
    expect(stand!.aufrufe.slice(2).map(gefragteItemId)).toEqual(["B", "C"]);
  });

  it("faehrt zwei Anstoesse zur selben Zeit nicht doppelt, holt aber den zweiten nach", async () => {
    aufbauen(["A"]);
    await Promise.all([stand!.erneuerer.anstossen(PRUEF_KENNUNG), stand!.erneuerer.anstossen(PRUEF_KENNUNG)]);
    await stand!.erneuerer.abgeschlossen();
    // Ein Lauf plus genau ein Nachlauf, nicht zwei gleichzeitige.
    expect(stand!.aufrufe).toHaveLength(2);
  });

  it("wirft Eintraege mit Token beim Tausch weg", async () => {
    aufbauen(["A"]);
    await stand!.erneuerer.faelligePruefen();
    await holen("/shells", { authorization: "Bearer x" });
    expect(stand!.puffer.anzahl(proxyId())).toBe(2);
    await stand!.erneuerer.anstossen(PRUEF_KENNUNG);
    expect(stand!.puffer.anzahl(proxyId())).toBe(1);
  });

  it("laesst nicht beteiligte Proxys aus und raeumt ihren Bestand weg", async () => {
    aufbauen(["A"]);
    await stand!.erneuerer.faelligePruefen();
    expect(stand!.puffer.anzahl(proxyId())).toBe(1);
    stand!.proxys.aendern(PRUEF_KENNUNG, { shellsAktiv: false, registryAktiv: false, submodelRegistryAktiv: false });
    await stand!.erneuerer.faelligePruefen();
    expect(stand!.puffer.anzahl(proxyId())).toBe(0);
    expect(stand!.erneuerer.stand(proxyId())).toEqual({ erneuertAm: null, naechsteErneuerung: null, laeuft: false });
    expect(stand!.aufrufe).toHaveLength(1);
  });

  it("puffert und erneuert nicht bei Dauer 0", async () => {
    aufbauen(["A"]);
    stand!.proxys.aendern(PRUEF_KENNUNG, { pufferStunden: 0 });
    await stand!.erneuerer.faelligePruefen();
    expect(stand!.aufrufe).toHaveLength(0);
    expect(Erneuerer.beteiligt(stand!.proxys.nachKennung(PRUEF_KENNUNG)!)).toBe(false);
  });

  it("zaehlt jeden der drei Schalter als beteiligt", () => {
    aufbauen([]);
    const basis = stand!.proxys.nachKennung(PRUEF_KENNUNG)!;
    const aus = { ...basis, shellsAktiv: false, registryAktiv: false, submodelRegistryAktiv: false };
    expect(Erneuerer.beteiligt(aus)).toBe(false);
    expect(Erneuerer.beteiligt({ ...aus, shellsAktiv: true })).toBe(true);
    expect(Erneuerer.beteiligt({ ...aus, registryAktiv: true })).toBe(true);
    expect(Erneuerer.beteiligt({ ...aus, submodelRegistryAktiv: true })).toBe(true);
  });
});
