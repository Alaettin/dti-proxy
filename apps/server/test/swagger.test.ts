import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { zusammenfuehren, type OpenApiDokument } from "../src/openapi.js";
import { pruefstand, roheAnfrage, type Pruefstand } from "./hilfe.js";

const hier = path.dirname(fileURLToPath(import.meta.url));
const vorlage = JSON.parse(
  readFileSync(path.join(hier, "../spec/aas.swagger.json"), "utf8"),
) as OpenApiDokument;

let stand: Pruefstand | undefined;

afterEach(() => {
  stand?.schliessen();
  stand = undefined;
});

describe("zusammenfuehren", () => {
  it("laesst die zehn Pfade von oben Zeichen fuer Zeichen unveraendert", () => {
    const zusammen = zusammenfuehren(vorlage, "https://proxy.test");
    for (const pfad of Object.keys(vorlage.paths)) {
      expect(zusammen.paths[pfad], pfad).toEqual(vorlage.paths[pfad]);
    }
  });

  it("setzt die Basis auf den Proxy um", () => {
    expect(zusammenfuehren(vorlage, "https://proxy.test").servers).toEqual([{ url: "https://proxy.test" }]);
  });

  it("haengt Discovery als eigenen Abschnitt an", () => {
    const zusammen = zusammenfuehren(vorlage, "https://proxy.test");
    expect(Object.keys(zusammen.paths)).toHaveLength(Object.keys(vorlage.paths).length + 1);
    expect(zusammen.paths["/lookup/shellsByAssetLink"]).toBeDefined();
    expect(zusammen.tags?.map((tag) => tag.name)).toContain("Discovery");
    expect(zusammen.components?.schemas?.AssetLink).toBeDefined();
    // Die Schemas von oben bleiben daneben stehen.
    expect(zusammen.components?.schemas?.DescriptionResponse).toBeDefined();
  });

  it("laesst die Vorlage selbst unberuehrt", () => {
    const vorher = JSON.stringify(vorlage);
    zusammenfuehren(vorlage, "https://proxy.test");
    expect(JSON.stringify(vorlage)).toBe(vorher);
  });
});

describe("GET /swagger/aas/swagger.json", () => {
  it("liefert die Spec von oben, zusammengefuehrt", async () => {
    stand = pruefstand((aufruf) => {
      if (aufruf.url.endsWith("/swagger/aas/swagger.json")) {
        return new Response(JSON.stringify(vorlage), { headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    });
    const antwort = await roheAnfrage(stand.app, "/swagger/aas/swagger.json");

    expect(antwort.status).toBe(200);
    expect(antwort.kopfzeilen["x-spec-quelle"]).toBe("oben");
    const dokument = JSON.parse(antwort.koerper) as OpenApiDokument;
    expect(Object.keys(dokument.paths)).toHaveLength(11);
    expect(dokument.servers[0]!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("faellt auf die mitgelieferte Kopie zurueck, wenn oben nichts antwortet", async () => {
    stand = pruefstand(() => {
      throw new Error("ECONNREFUSED");
    });
    const antwort = await roheAnfrage(stand.app, "/swagger/aas/swagger.json");

    expect(antwort.status).toBe(200);
    expect(antwort.kopfzeilen["x-spec-quelle"]).toBe("kopie");
    expect(Object.keys((JSON.parse(antwort.koerper) as OpenApiDokument).paths)).toHaveLength(11);
  });

  it("nimmt Muell von oben nicht an", async () => {
    stand = pruefstand((aufruf) =>
      aufruf.url.endsWith("swagger.json")
        ? new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } })
        : new Response("{}"),
    );
    const antwort = await roheAnfrage(stand.app, "/swagger/aas/swagger.json");

    expect(antwort.kopfzeilen["x-spec-quelle"]).toBe("kopie");
  });

  it("nutzt die eingestellte Proxy-Basis, wenn eine gesetzt ist", async () => {
    stand = pruefstand(() => new Response(JSON.stringify(vorlage)));
    stand.einstellungen.schreiben({ proxyBasis: "https://dti-proxy.beispiel.test/" });
    // Der Standard liegt an der Wurzel, also ohne Praefix.
    const antwort = await roheAnfrage(stand.app, "/swagger/aas/swagger.json");

    expect((JSON.parse(antwort.koerper) as OpenApiDokument).servers).toEqual([
      { url: "https://dti-proxy.beispiel.test" },
    ]);
  });
});

describe("Swagger-Oberflaeche", () => {
  it("liefert die Seite und verweist auf die eigene Spec", async () => {
    stand = pruefstand();
    const antwort = await roheAnfrage(stand.app, "/swagger/index.html");

    expect(antwort.status).toBe(200);
    expect(antwort.koerper).toContain('url: "/swagger/aas/swagger.json"');
  });

  it("liefert die Dateien von swagger-ui-dist einmal fuer alle Proxys aus", async () => {
    stand = pruefstand();
    const antwort = await roheAnfrage(stand.app, "/swagger-ui/swagger-ui.css");

    expect(antwort.status).toBe(200);
    expect(antwort.kopfzeilen["content-type"]).toContain("text/css");
  });
});
