import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assetIdKodieren, AUFRUFE, aufrufeFuer, base64url, curlBauen, urlBauen, type Aufruf } from "../src/aufrufe.js";

const hier = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(
  readFileSync(path.join(hier, "../../server/spec/aas.swagger.json"), "utf8"),
) as { paths: Record<string, unknown> };

function nimm(id: string): Aufruf {
  const gefunden = AUFRUFE.find((aufruf) => aufruf.id === id);
  if (gefunden === undefined) throw new Error(`Aufruf ${id} fehlt im Katalog`);
  return gefunden;
}

describe("aufrufeFuer", () => {
  const vorlagen = (liste: Aufruf[]): string[] => liste.map((aufruf) => aufruf.vorlage);

  const AUS = { shellsAktiv: false, registryAktiv: false, submodelRegistryAktiv: false };

  it("nimmt bei allen Schaltern an alle Aufrufe auf", () => {
    expect(aufrufeFuer({ shellsAktiv: true, registryAktiv: true, submodelRegistryAktiv: true })).toHaveLength(
      AUFRUFE.length,
    );
  });

  it("laesst GET /shells und die Registries je nach Schalter weg", () => {
    const keiner = aufrufeFuer(AUS);
    expect(keiner).toHaveLength(AUFRUFE.length - 5);
    expect(vorlagen(keiner)).not.toContain("/shells");
    expect(vorlagen(keiner)).not.toContain("/shell-descriptors");
    expect(vorlagen(keiner)).not.toContain("/submodel-descriptors");

    const nurRegistry = vorlagen(aufrufeFuer({ ...AUS, registryAktiv: true }));
    expect(nurRegistry).toContain("/shell-descriptors");
    expect(nurRegistry).toContain("/shell-descriptors/{aasIdentifier}");
    expect(nurRegistry).not.toContain("/shells");
    expect(nurRegistry).not.toContain("/submodel-descriptors");

    const nurSubmodel = vorlagen(aufrufeFuer({ ...AUS, submodelRegistryAktiv: true }));
    expect(nurSubmodel).toContain("/submodel-descriptors");
    expect(nurSubmodel).toContain("/submodel-descriptors/{submodelIdentifier}");
    expect(nurSubmodel).not.toContain("/shell-descriptors");

    const nurShells = vorlagen(aufrufeFuer({ ...AUS, shellsAktiv: true }));
    expect(nurShells).toContain("/shells");
    expect(nurShells).not.toContain("/shell-descriptors");
  });
});

describe("Katalog", () => {
  it("deckt die Pfade der Spec plus GET /shells, beide Registries und Discovery ab, sonst fehlt oder faulenzt einer", () => {
    const imKatalog = AUFRUFE.map((aufruf) => aufruf.vorlage).sort();
    const erwartet = [
      ...Object.keys(spec.paths),
      "/shells",
      "/shell-descriptors",
      "/shell-descriptors/{aasIdentifier}",
      "/submodel-descriptors",
      "/submodel-descriptors/{submodelIdentifier}",
      "/lookup/shellsByAssetLink",
    ].sort();
    expect(imKatalog).toEqual(erwartet);
  });

  it("kodiert assetType der Registry als base64url, nur mit Schalter", () => {
    const aufruf = nimm("shell-descriptors");
    const an = new URL(urlBauen(aufruf, { assetType: "Pumpe/1", assetKind: "Type" }, true), "https://x.test");
    expect(an.searchParams.get("assetType")).toBe(base64url("Pumpe/1"));
    expect(an.searchParams.get("assetKind")).toBe("Type");
    expect(urlBauen(aufruf, { assetType: "roh" }, false)).toBe("/shell-descriptors?assetType=roh");
  });

  it("kodiert die Kennung im Einzelabruf der Submodel Registry", () => {
    const url = urlBauen(nimm("submodel-descriptor"), { submodelIdentifier: "https://x.test/sm?itemId=A" }, true);
    expect(url).toBe(`/submodel-descriptors/${base64url("https://x.test/sm?itemId=A")}`);
  });

  it("kodiert die Kennung im Einzelabruf der Registry", () => {
    const url = urlBauen(nimm("shell-descriptor"), { aasIdentifier: "https://x.test/aas?itemId=A" }, true, "/p/rc");
    expect(url).toBe(`/p/rc/shell-descriptors/${base64url("https://x.test/aas?itemId=A")}`);
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

  // Mit mehreren Proxys entscheidet das Praefix, welches Ziel gefragt wird.
  it("stellt das Praefix des Proxys voran", () => {
    expect(urlBauen(nimm("description"), {}, true, "/p/kunde-a")).toBe("/p/kunde-a/description");
    const mitQuery = urlBauen(nimm("submodel"), { submodelIdentifier: "https://a.test/1", level: "Deep" }, true, "/p/zwei");
    expect(mitQuery.startsWith("/p/zwei/submodels/")).toBe(true);
    expect(mitQuery.endsWith("?level=Deep")).toBe(true);
  });

  it("laesst den Standard ohne Praefix", () => {
    expect(urlBauen(nimm("description"), {}, true, "")).toBe("/description");
  });

  it("nimmt fehlende Werte als leer, statt den Platzhalter stehen zu lassen", () => {
    expect(urlBauen(nimm("shell"), {}, true)).toBe("/shells/");
  });
});

describe("assetIds von GET /shells", () => {
  const GLOBAL = "https://viewer-rc.test.dti.neoception.dev/VNDP77EV202504291";

  it("kodiert jede globalAssetId als SpecificAssetId", () => {
    const zurueck = JSON.parse(Buffer.from(assetIdKodieren(GLOBAL), "base64url").toString("utf8")) as unknown;
    expect(zurueck).toEqual({ name: "globalAssetId", value: GLOBAL });
  });

  it("haengt mehrere Werte einzeln und kodiert an", () => {
    const url = urlBauen(nimm("shells"), { assetIds: `${GLOBAL}, https://x.test/B`, limit: "5" }, true, "/p/rc");
    const anfrage = new URL(url, "https://proxy.test").searchParams;
    expect(new URL(url, "https://proxy.test").pathname).toBe("/p/rc/shells");
    expect(anfrage.getAll("assetIds")).toEqual([assetIdKodieren(GLOBAL), assetIdKodieren("https://x.test/B")]);
    expect(anfrage.get("limit")).toBe("5");
  });

  it("laesst die Werte roh, wenn der Schalter aus ist (Gegenprobe)", () => {
    const url = urlBauen(nimm("shells"), { assetIds: "schon-kodiert" }, false);
    expect(url).toBe("/shells?assetIds=schon-kodiert");
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
