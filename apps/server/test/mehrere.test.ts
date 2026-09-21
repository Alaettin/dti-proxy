import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenApiDokument } from "../src/openapi.js";
import { PRUEF_BASIS, pruefstand, roheAnfrage, type Pruefstand } from "./hilfe.js";

const hier = path.dirname(fileURLToPath(import.meta.url));
const vorlage = JSON.parse(readFileSync(path.join(hier, "../spec/aas.swagger.json"), "utf8")) as OpenApiDokument;

let stand: Pruefstand | undefined;

afterEach(() => {
  stand?.schliessen();
  stand = undefined;
});

/** Ein Pruefstand mit einem zweiten Proxy auf ein anderes Ziel. */
function mitZweitem(antwort?: Parameters<typeof pruefstand>[0]): Pruefstand {
  const gebaut = pruefstand(antwort);
  const angelegt = gebaut.proxys.anlegen({
    kennung: "zwei",
    name: "Zwei",
    upstreamBasis: "https://zwei.beispiel.test",
    aasBasis: "https://viewer-zwei.test",
    zeitlimitMs: 30_000,
  });
  if ("verstoesse" in angelegt) throw new Error(JSON.stringify(angelegt.verstoesse));
  return gebaut;
}

describe("Weiterleitung mit mehreren Proxys", () => {
  it("reicht den rohen Rest hinter dem Praefix zeichengenau weiter", async () => {
    const rest = "/submodels/aHR0cDovL2E-Yg_c/submodel-elements/Nameplate%2FManufacturerName?level=Deep";
    stand = mitZweitem();
    const antwort = await roheAnfrage(stand.app, "/p/zwei" + rest);

    expect(antwort.status).toBe(200);
    expect(stand.aufrufe).toHaveLength(1);
    expect(stand.aufrufe[0]!.url).toBe("https://zwei.beispiel.test" + rest);
  });

  it("schickt jeden Aufruf zu seinem eigenen Ziel", async () => {
    stand = mitZweitem();
    await roheAnfrage(stand.app, PRUEF_BASIS + "/description");
    await roheAnfrage(stand.app, "/p/zwei/description");

    expect(stand.aufrufe.map((a) => a.url)).toEqual([
      "https://oben.beispiel.test/description",
      "https://zwei.beispiel.test/description",
    ]);
  });

  // Kein Proxy hat einen Sonderplatz: die Wurzel bedient auch dann niemand,
  // wenn es nur einen einzigen gibt.
  it("bedient die Wurzel auch mit mehreren Proxys nicht", async () => {
    stand = mitZweitem();
    const antwort = await roheAnfrage(stand.app, "/description");

    expect(antwort.status).toBe(404);
    expect(stand.aufrufe).toHaveLength(0);
  });

  it("antwortet bei unbekannter Kennung mit 404 und fragt niemanden", async () => {
    stand = mitZweitem();
    const antwort = await roheAnfrage(stand.app, "/p/gibtsnicht/description");

    expect(antwort.status).toBe(404);
    expect(stand.aufrufe).toHaveLength(0);
  });

  it("nimmt das Zeitlimit des angesprochenen Proxys", async () => {
    stand = mitZweitem(async () => {
      await new Promise((warten) => setTimeout(warten, 1500));
      return new Response("{}");
    });
    stand.proxys.aendern("zwei", { zeitlimitMs: "1000" });
    const antwort = await roheAnfrage(stand.app, "/p/zwei/description");

    expect(antwort.status).toBe(502);
    expect(antwort.koerper).toContain("within 1000 ms");
  });
});

describe("Discovery mit mehreren Proxys", () => {
  async function lookup(pfad: string): Promise<{ status: number; result: string[] }> {
    const koerper = JSON.stringify([{ name: "globalAssetId", value: "https://egal.test/4711" }]);
    const antwort = await roheAnfrage(stand!.app, pfad, {
      methode: "POST",
      kopfzeilen: { "content-type": "application/json", "content-length": String(Buffer.byteLength(koerper)) },
      koerper,
    });
    return { status: antwort.status, result: (JSON.parse(antwort.koerper) as { result: string[] }).result };
  }

  it("benutzt die aasBasis des angesprochenen Proxys", async () => {
    stand = mitZweitem();
    expect((await lookup(PRUEF_BASIS + "/lookup/shellsByAssetLink")).result).toEqual([
      "https://viewer-rc.test.dti.neoception.dev/aas?itemId=4711",
    ]);
    expect((await lookup("/p/zwei/lookup/shellsByAssetLink")).result).toEqual([
      "https://viewer-zwei.test/aas?itemId=4711",
    ]);
  });

  it("gibt es weder an der Wurzel noch unter einer unbekannten Kennung", async () => {
    stand = mitZweitem();
    for (const pfad of ["/lookup/shellsByAssetLink", "/p/gibtsnicht/lookup/shellsByAssetLink"]) {
      const antwort = await roheAnfrage(stand.app, pfad, {
        methode: "POST",
        kopfzeilen: { "content-type": "application/json", "content-length": "2" },
        koerper: "[]",
      });
      expect(antwort.status, pfad).toBe(404);
    }
  });
});

describe("Swagger mit mehreren Proxys", () => {
  it("traegt je Proxy dessen eigene Basis im servers-Block", async () => {
    stand = mitZweitem(() => new Response(JSON.stringify(vorlage)));
    stand.einstellungen.schreiben({ proxyBasis: "https://dti-proxy.test" });

    const eins = await roheAnfrage(stand.app, PRUEF_BASIS + "/swagger/aas/swagger.json");
    const zwei = await roheAnfrage(stand.app, "/p/zwei/swagger/aas/swagger.json");

    expect((JSON.parse(eins.koerper) as OpenApiDokument).servers).toEqual([{ url: "https://dti-proxy.test/p/eins" }]);
    expect((JSON.parse(zwei.koerper) as OpenApiDokument).servers).toEqual([{ url: "https://dti-proxy.test/p/zwei" }]);
  });

  it("holt die Spec je Zielsystem getrennt", async () => {
    const gefragt: string[] = [];
    stand = mitZweitem((aufruf) => {
      if (aufruf.url.endsWith("swagger.json")) gefragt.push(aufruf.url);
      return new Response(JSON.stringify(vorlage));
    });

    await roheAnfrage(stand.app, PRUEF_BASIS + "/swagger/aas/swagger.json");
    await roheAnfrage(stand.app, "/p/zwei/swagger/aas/swagger.json");

    expect(gefragt).toEqual([
      "https://oben.beispiel.test/swagger/aas/swagger.json",
      "https://zwei.beispiel.test/swagger/aas/swagger.json",
    ]);
  });

  it("liefert je Proxy eine Seite, die auf die eigene Spec zeigt", async () => {
    stand = mitZweitem();
    const seite = await roheAnfrage(stand.app, "/p/zwei/swagger/index.html");

    expect(seite.status).toBe(200);
    expect(seite.koerper).toContain('url: "/p/zwei/swagger/aas/swagger.json"');
    expect(seite.koerper).toContain("/swagger-ui/swagger-ui.css");
  });

  it("leitet vom blanken Proxy-Weg auf dessen Seite", async () => {
    stand = mitZweitem();
    const antwort = await roheAnfrage(stand.app, "/p/zwei");

    expect(antwort.status).toBe(302);
    expect(antwort.kopfzeilen.location).toBe("/p/zwei/swagger/index.html");
  });
});

describe("Proxys anlegen und loeschen", () => {
  it("laesst auch den letzten loeschen", async () => {
    stand = mitZweitem();
    expect(stand.proxys.loeschen("zwei")).toBeNull();
    expect(stand.proxys.loeschen("eins")).toBeNull();
    expect(stand.proxys.alle()).toHaveLength(0);
  });

  // Die Kennung steht in der Adresse. Wuerde sie beim Umbenennen mitwandern,
  // braeche die Adresse allen Aufrufern weg.
  it("laesst die Kennung beim Umbenennen stehen", async () => {
    stand = mitZweitem();
    stand.proxys.aendern("zwei", { name: "Ganz anderer Name" });

    expect(stand.proxys.nachKennung("zwei")!.name).toBe("Ganz anderer Name");
    const antwort = await roheAnfrage(stand.app, "/p/zwei/description");
    expect(antwort.status).toBe(200);
  });
});
