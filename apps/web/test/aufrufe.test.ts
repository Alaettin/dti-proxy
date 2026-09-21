import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUFRUFE, base64url, curlBauen, urlBauen, type Aufruf } from "../src/aufrufe.js";

const hier = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(
  readFileSync(path.join(hier, "../../server/spec/aas.swagger.json"), "utf8"),
) as { paths: Record<string, unknown> };

function nimm(id: string): Aufruf {
  const gefunden = AUFRUFE.find((aufruf) => aufruf.id === id);
  if (gefunden === undefined) throw new Error(`Aufruf ${id} fehlt im Katalog`);
  return gefunden;
}

describe("Katalog", () => {
  it("deckt die Pfade der Spec plus Discovery ab, sonst fehlt oder faulenzt einer", () => {
    const imKatalog = AUFRUFE.map((aufruf) => aufruf.vorlage).sort();
    const erwartet = [...Object.keys(spec.paths), "/lookup/shellsByAssetLink"].sort();
    expect(imKatalog).toEqual(erwartet);
  });

  it("vergibt jede Kennung nur einmal", () => {
    const ids = AUFRUFE.map((aufruf) => aufruf.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("nennt fuer jeden Platzhalter in der Vorlage auch einen Parameter", () => {
    for (const aufruf of AUFRUFE) {
      const platzhalter = [...aufruf.vorlage.matchAll(/\{(\w+)\}/g)].map((treffer) => treffer[1]);
      const pfadparameter = aufruf.parameter.filter((p) => p.ort === "pfad").map((p) => p.name);
      expect(pfadparameter.sort(), aufruf.id).toEqual([...platzhalter].sort());
    }
  });
});

describe("base64url", () => {
  it("liefert den Wert, der gegen die echte Instanz geprueft wurde", () => {
    expect(base64url("https://viewer-rc.test.dti.neoception.dev/aas?itemId=VNDP77EV202504291")).toBe(
      "aHR0cHM6Ly92aWV3ZXItcmMudGVzdC5kdGkubmVvY2VwdGlvbi5kZXYvYWFzP2l0ZW1JZD1WTkRQNzdFVjIwMjUwNDI5MQ",
    );
  });

  it("verwendet das URL-Alphabet und kein Auffuellzeichen", () => {
    for (const eingabe of [
      "https://a.test/1",
      "https://viewer-rc.test.dti.neoception.dev/aas?itemId=VNDP77EV202504291",
      "ab",
      "abc",
    ]) {
      const kodiert = base64url(eingabe);
      expect(kodiert, eingabe).not.toMatch(/[+/=]/);
    }
  });

  it("laesst sich wieder zurueckrechnen", () => {
    const eingabe = "https://example.com/assets/ABC123";
    expect(Buffer.from(base64url(eingabe), "base64url").toString("utf8")).toBe(eingabe);
  });
});

describe("urlBauen", () => {
  it("kodiert die Kennung und setzt sie in den Pfad", () => {
    const url = urlBauen(nimm("shell"), { aasIdentifier: "https://a.test/1" }, true);
    expect(url).toBe(`/shells/${base64url("https://a.test/1")}`);
  });

  // Die eigentliche Falle: ein Schraegstrich im idShortPath darf kein Trenner
  // werden, sonst zeigt die Anfrage auf einen ganz anderen Pfad.
  it("setzt einen Schraegstrich im idShortPath als %2F ein", () => {
    const url = urlBauen(
      nimm("submodel-element"),
      { submodelIdentifier: "https://a.test/1", idShortPath: "Nameplate/ManufacturerName" },
      true,
    );
    expect(url).toContain("/submodel-elements/Nameplate%2FManufacturerName");
    expect(url.split("/submodel-elements/")[1]).not.toContain("/");
  });

  it("laesst die Kennung roh, wenn der Schalter aus ist (Gegenprobe)", () => {
    const werte = { aasIdentifier: "https://a.test/1" };
    expect(urlBauen(nimm("shell"), werte, false)).toBe("/shells/https%3A%2F%2Fa.test%2F1");
    expect(urlBauen(nimm("shell"), werte, true)).not.toBe(urlBauen(nimm("shell"), werte, false));
  });

  it("haengt leere Query-Parameter nicht an", () => {
    const url = urlBauen(nimm("submodel"), { submodelIdentifier: "https://a.test/1", level: "", extent: "" }, true);
    expect(url).not.toContain("?");
  });

  it("haengt gefuellte Query-Parameter an", () => {
    const url = urlBauen(nimm("submodel"), { submodelIdentifier: "https://a.test/1", level: "Deep", extent: "" }, true);
    expect(url.endsWith("?level=Deep")).toBe(true);
  });

  it("teilt ein Listenfeld an Kommata und haengt es mehrfach an", () => {
    const url = urlBauen(nimm("serialization"), { aasIds: "a, b", submodelIds: "", serializationFormat: "AASX" }, true);
    expect(url).toBe("/serialization?aasIds=a&aasIds=b&serializationFormat=AASX");
  });

  it("kommt ohne Parameter aus", () => {
    expect(urlBauen(nimm("description"), {}, true)).toBe("/description");
  });

  it("nimmt fehlende Werte als leer, statt den Platzhalter stehen zu lassen", () => {
    expect(urlBauen(nimm("shell"), {}, true)).toBe("/shells/");
  });
});

describe("curlBauen", () => {
  it("baut eine Zeile, die sich ausserhalb nachstellen laesst", () => {
    const zeile = curlBauen(nimm("description"), "/description", "http://localhost:3000", "", "");
    expect(zeile).toBe("curl -i -X GET 'http://localhost:3000/description'");
  });

  it("nimmt Authorization und Koerper mit, wenn beides da ist", () => {
    const aufruf = nimm("discovery");
    const zeile = curlBauen(aufruf, "/lookup/shellsByAssetLink", "http://localhost:3000", '[{"name":"x"}]', "Bearer abc");
    expect(zeile).toContain("-H 'authorization: Bearer abc'");
    expect(zeile).toContain("-H 'content-type: application/json'");
    expect(zeile).toContain(`-d '[{"name":"x"}]'`);
  });
});
