import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AAS_PFADE, istAasPfad, zuMuster } from "../src/pfade.js";

const hier = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(path.join(hier, "../spec/aas.swagger.json"), "utf8")) as {
  paths: Record<string, unknown>;
};

describe("Pfadliste", () => {
  it("deckt sich mit der Spec von oben, sonst ist die Liste veraltet", () => {
    expect([...AAS_PFADE].sort()).toEqual(Object.keys(spec.paths).sort());
  });
});

describe("zuMuster", () => {
  it("nimmt base64url-IDs mit - und _", () => {
    const muster = zuMuster("/shells/{aasIdentifier}");
    expect(muster.test("/shells/aHR0cHM6-y92aWV3_XI")).toBe(true);
  });

  it("liest %2F nicht als Trenner", () => {
    const muster = zuMuster("/submodels/{submodelIdentifier}/submodel-elements/{idShortPath}");
    expect(muster.test("/submodels/abc/submodel-elements/Nameplate%2FManufacturerName")).toBe(true);
  });

  it("laesst einen echten Schraegstrich zu viel nicht durch", () => {
    const muster = zuMuster("/shells/{aasIdentifier}");
    expect(muster.test("/shells/abc/def")).toBe(false);
  });

  it("erlaubt einen Query-Teil", () => {
    expect(zuMuster("/serialization").test("/serialization?aasIds=a&aasIds=b")).toBe(true);
  });
});

describe("istAasPfad", () => {
  it("kennt alle zehn Pfade", () => {
    const beispiele = [
      "/shells/QUJD",
      "/shells/QUJD/asset-information",
      "/shells/QUJD/asset-information/thumbnail",
      "/shells/QUJD/submodel-refs",
      "/shells/QUJD/submodels/REVG",
      "/description",
      "/serialization",
      "/submodels/REVG",
      "/submodels/REVG/submodel-elements/A%2FB",
      "/submodels/REVG/submodel-elements/A%2FB/attachment",
    ];
    for (const pfad of beispiele) expect(istAasPfad(pfad), pfad).toBe(true);
  });

  it("laesst die Connector-API und die Weboberflaeche von oben nicht durch", () => {
    for (const pfad of ["/api/connector/model", "/swagger/index.html", "/", "/shells", "/lookup/shellsByAssetLink"]) {
      expect(istAasPfad(pfad), pfad).toBe(false);
    }
  });
});
