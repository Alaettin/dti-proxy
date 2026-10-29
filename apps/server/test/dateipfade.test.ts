import { describe, expect, it } from "vitest";
import { antwortUmschreiben, istRelativ, schaleUmschreiben, umschreibbar } from "../src/dateipfade.js";

const BASIS = "https://dienst.test/p/eins";
const SM = "aHR0cHM6Ly90ZXN0L3NtL05hbWVwbGF0ZQ";
const AAS = "aHR0cHM6Ly90ZXN0L2Fhcw";

/** Aufbau wie das Nameplate von VNDP77EV202504291 in rc, auf das Noetige gekuerzt. */
function typenschild(): Record<string, unknown> {
  return {
    idShort: "Nameplate",
    id: "https://test/sm/Nameplate",
    modelType: "Submodel",
    submodelElements: [
      { idShort: "SerialNumber", valueType: "xs:string", value: "/aasx/suppl/kein-file", modelType: "Property" },
      { idShort: "CompanyLogo", value: "/aasx/suppl/logo.png", contentType: "image/png", modelType: "File" },
      {
        idShort: "Markings",
        typeValueListElement: "SubmodelElementCollection",
        modelType: "SubmodelElementList",
        value: [
          {
            idShort: "",
            modelType: "SubmodelElementCollection",
            value: [
              { idShort: "MarkingName", valueType: "xs:string", value: "CE marking", modelType: "Property" },
              { idShort: "MarkingFile", value: "/aasx/suppl/16289094_edz.edz", modelType: "File" },
            ],
          },
          {
            idShort: "",
            modelType: "SubmodelElementCollection",
            value: [{ idShort: "MarkingFile", value: "/aasx/suppl/demo.stp", modelType: "File" }],
          },
        ],
      },
      {
        idShort: "Teil",
        modelType: "Entity",
        statements: [{ idShort: "Bild", value: "bild.png", modelType: "File" }],
      },
      { idShort: "Fern", value: "https://cdn.test/a.pdf", modelType: "File" },
      { idShort: "Klumpen", value: "AAEC", contentType: "application/octet-stream", modelType: "Blob" },
    ],
  };
}

type Element = { idShort: string; value: unknown; statements?: Element[] };

function elemente(koerper: unknown): Element[] {
  return (koerper as { submodelElements: Element[] }).submodelElements;
}

describe("istRelativ", () => {
  it("erkennt relative Pfade", () => {
    for (const wert of ["/aasx/suppl/logo.png", "logo.png", "./a/b.pdf", "aasx/suppl/x.stp"]) {
      expect(istRelativ(wert), wert).toBe(true);
    }
  });

  it("laesst absolute Adressen, leere Werte und Nicht-Text aus", () => {
    for (const wert of ["https://cdn.test/a.pdf", "HTTP://x", "urn:x:y", "file:///c/a", "//cdn.test/a", "", null, 3]) {
      expect(istRelativ(wert), String(wert)).toBe(false);
    }
  });
});

describe("antwortUmschreiben", () => {
  it("zeigt File-Werte eines Teilmodells auf /attachment des Proxys, auch verschachtelt", () => {
    const neu = elemente(antwortUmschreiben(`/submodels/${SM}`, typenschild(), BASIS));
    const elementeBasis = `${BASIS}/submodels/${SM}/submodel-elements/`;

    expect(neu[1]!.value).toBe(`${elementeBasis}CompanyLogo/attachment`);
    const liste = neu[2]!.value as { value: Element[] }[];
    // Listenelemente tragen ihren Platz, [ und ] kodiert: so nimmt rc sie an.
    expect(liste[0]!.value[1]!.value).toBe(`${elementeBasis}Markings%5B0%5D.MarkingFile/attachment`);
    expect(liste[1]!.value[0]!.value).toBe(`${elementeBasis}Markings%5B1%5D.MarkingFile/attachment`);
    expect(neu[3]!.statements![0]!.value).toBe(`${elementeBasis}Teil.Bild/attachment`);
  });

  it("laesst absolute File-Werte, Property und Blob stehen", () => {
    const neu = elemente(antwortUmschreiben(`/submodels/${SM}`, typenschild(), BASIS));
    expect(neu[0]!.value).toBe("/aasx/suppl/kein-file");
    expect(neu[4]!.value).toBe("https://cdn.test/a.pdf");
    expect(neu[5]!.value).toBe("AAEC");
    const liste = neu[2]!.value as { value: Element[] }[];
    expect(liste[0]!.value[0]!.value).toBe("CE marking");
  });

  it("nimmt fuer das Teilmodell unter einer Schale den eigenstaendigen Pfad", () => {
    const neu = elemente(antwortUmschreiben(`/shells/${AAS}/submodels/${SM}?level=deep`, typenschild(), BASIS));
    expect(neu[1]!.value).toBe(`${BASIS}/submodels/${SM}/submodel-elements/CompanyLogo/attachment`);
  });

  it("schreibt ein einzeln geholtes Element mit seinem rohen Pfad um", () => {
    // Das %2F bleibt, wie es kam: dekodiert waere es ein Trenner.
    const elementeBasis = `${BASIS}/submodels/${SM}/submodel-elements/`;
    const element = {
      idShort: "",
      modelType: "SubmodelElementCollection",
      value: [{ idShort: "MarkingFile", value: "/aasx/suppl/demo.stp", modelType: "File" }],
    };
    const neu = antwortUmschreiben(`/submodels/${SM}/submodel-elements/Markings%5B1%5D`, element, BASIS) as {
      value: Element[];
    };
    expect(neu.value[0]!.value).toBe(`${elementeBasis}Markings%5B1%5D.MarkingFile/attachment`);

    const datei = { idShort: "Logo", value: "logo.png", modelType: "File" };
    const geholt = antwortUmschreiben(`/submodels/${SM}/submodel-elements/A%2FB`, datei, BASIS) as Element;
    expect(geholt.value).toBe(`${elementeBasis}A%2FB/attachment`);
  });

  it("zeigt das Vorschaubild von Schale und asset-information auf /thumbnail", () => {
    const ziel = `${BASIS}/shells/${AAS}/asset-information/thumbnail`;
    const schale = { id: "x", assetInformation: { defaultThumbnail: { path: "/aasx/suppl/image.png" } } };
    expect(antwortUmschreiben(`/shells/${AAS}`, schale, BASIS)).toEqual({
      id: "x",
      assetInformation: { defaultThumbnail: { path: ziel } },
    });
    const info = { assetKind: "Instance", defaultThumbnail: { path: "image.png", contentType: "image/png" } };
    expect(antwortUmschreiben(`/shells/${AAS}/asset-information`, info, BASIS)).toEqual({
      assetKind: "Instance",
      defaultThumbnail: { path: ziel, contentType: "image/png" },
    });
    const fern = { defaultThumbnail: { path: "https://cdn.test/b.png" } };
    expect(antwortUmschreiben(`/shells/${AAS}/asset-information`, fern, BASIS)).toEqual(fern);
  });

  it("veraendert die Eingabe nicht", () => {
    const eingabe = typenschild();
    const vorher = JSON.stringify(eingabe);
    antwortUmschreiben(`/submodels/${SM}`, eingabe, BASIS);
    expect(JSON.stringify(eingabe)).toBe(vorher);
  });
});

describe("umschreibbar", () => {
  it("trifft genau die Pfade, deren Antwort Dateipfade tragen kann", () => {
    for (const pfad of [
      `/shells/${AAS}`,
      `/shells/${AAS}/asset-information`,
      `/shells/${AAS}/submodels/${SM}?level=core`,
      `/submodels/${SM}`,
      `/submodels/${SM}/submodel-elements/A.B`,
    ]) {
      expect(umschreibbar(pfad), pfad).toBe(true);
    }
    for (const pfad of [
      "/description",
      "/serialization?aasIds=x",
      `/shells/${AAS}/submodel-refs`,
      `/shells/${AAS}/asset-information/thumbnail`,
      `/submodels/${SM}/submodel-elements/A/attachment`,
    ]) {
      expect(umschreibbar(pfad), pfad).toBe(false);
    }
  });
});

describe("schaleUmschreiben", () => {
  it("liefert eine Kopie mit absolutem Vorschaubild", () => {
    const schale = { id: "x", assetInformation: { defaultThumbnail: { path: "image.png" } } };
    const neu = schaleUmschreiben(schale, BASIS, AAS);
    expect(neu).toEqual({
      id: "x",
      assetInformation: { defaultThumbnail: { path: `${BASIS}/shells/${AAS}/asset-information/thumbnail` } },
    });
    expect(schale.assetInformation.defaultThumbnail.path).toBe("image.png");
  });
});
