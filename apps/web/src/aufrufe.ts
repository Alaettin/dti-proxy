/**
 * Katalog der Aufrufe, die dieser Proxy anbietet, und der Bau der Adressen dazu.
 *
 * Bewusst getrennt von der Darstellung: die beiden Regeln weiter unten
 * (base64url für Kennungen, Kodierung der Pfadwerte) sind genau die Stellen,
 * an denen ein Fehler still bleibt. Getrennt lassen sie sich prüfen.
 */

export type Ort = "pfad" | "query";
export type Art = "text" | "auswahl" | "liste" | "schalter";

export interface Parameter {
  name: string;
  titel: string;
  ort: Ort;
  art: Art;
  /** Auswahlmöglichkeiten, nur bei art "auswahl". */
  werte?: string[];
  /** Kennung eines AAS oder Submodels, also Kandidat für base64url. */
  kennung?: boolean;
  hinweis?: string;
  vorgabe?: string;
}

export interface Aufruf {
  id: string;
  gruppe: string;
  methode: "GET" | "POST";
  /** Pfadvorlage mit Platzhaltern in geschweiften Klammern. */
  vorlage: string;
  beschreibung: string;
  parameter: Parameter[];
  /** Nur Discovery hat einen Körper. */
  koerperVorgabe?: string;
  /** Antwort kann etwas anderes als Text sein: Bild, AASX, Anhang. */
  binaer?: boolean;
}

/** Der Bezeichner des Assets, also die Eingabe von Discovery. */
const BEISPIEL_GLOBAL_ASSET_ID = "https://viewer-pf.test.dti.neoception.dev/70133076";

/**
 * Die Kennung einer Verwaltungsschale, also die Ausgabe von Discovery. Beides
 * zu verwechseln ist naheliegend und führt zu lauter 400ern: die AAS-Aufrufe
 * wollen diese Form, nicht die des Asset-Bezeichners.
 */
const BEISPIEL_AAS_ID = "https://viewer-pf.test.dti.neoception.dev/aas?itemId=70133076";

function kennung(name: string, titel: string): Parameter {
  return {
    name,
    titel,
    ort: "pfad",
    art: "text",
    kennung: true,
    vorgabe: BEISPIEL_AAS_ID,
    hinweis: "Im Klartext eingeben, das Kodieren übernimmt der Schalter darunter.",
  };
}

const LEVEL: Parameter = {
  name: "level",
  titel: "level",
  ort: "query",
  art: "auswahl",
  werte: ["Deep", "Core"],
  hinweis: "Wie tief die Antwort aufgelöst wird.",
};

const EXTENT: Parameter = {
  name: "extent",
  titel: "extent",
  ort: "query",
  art: "auswahl",
  werte: ["WithBlobValue", "WithoutBlobValue"],
  hinweis: "Ob eingebettete Dateien mitkommen.",
};

export const AUFRUFE: Aufruf[] = [
  {
    id: "shell",
    gruppe: "AssetAdministrationShellRepository",
    methode: "GET",
    vorlage: "/shells/{aasIdentifier}",
    beschreibung: "Die Verwaltungsschale zu einer Kennung.",
    parameter: [kennung("aasIdentifier", "aasIdentifier")],
  },
  {
    id: "shell-asset-information",
    gruppe: "AssetAdministrationShellRepository",
    methode: "GET",
    vorlage: "/shells/{aasIdentifier}/asset-information",
    beschreibung: "Die Angaben zum Asset hinter der Schale.",
    parameter: [kennung("aasIdentifier", "aasIdentifier")],
  },
  {
    id: "shell-thumbnail",
    gruppe: "AssetAdministrationShellRepository",
    methode: "GET",
    vorlage: "/shells/{aasIdentifier}/asset-information/thumbnail",
    beschreibung: "Das Vorschaubild des Assets. Die Antwort ist ein Bild, kein JSON.",
    parameter: [kennung("aasIdentifier", "aasIdentifier")],
    binaer: true,
  },
  {
    id: "shell-submodel-refs",
    gruppe: "AssetAdministrationShellRepository",
    methode: "GET",
    vorlage: "/shells/{aasIdentifier}/submodel-refs",
    beschreibung: "Die Verweise auf die Teilmodelle der Schale.",
    parameter: [kennung("aasIdentifier", "aasIdentifier")],
  },
  {
    id: "shell-submodel",
    gruppe: "AssetAdministrationShellRepository",
    methode: "GET",
    vorlage: "/shells/{aasIdentifier}/submodels/{submodelIdentifier}",
    beschreibung: "Ein Teilmodell im Zusammenhang seiner Schale.",
    parameter: [kennung("aasIdentifier", "aasIdentifier"), kennung("submodelIdentifier", "submodelIdentifier"), LEVEL, EXTENT],
  },
  {
    id: "description",
    gruppe: "Description",
    methode: "GET",
    vorlage: "/description",
    beschreibung: "Welche Profile das Zielsystem für sich beansprucht.",
    parameter: [],
  },
  {
    id: "serialization",
    gruppe: "Serialization",
    methode: "GET",
    vorlage: "/serialization",
    beschreibung: "Mehrere Schalen und Teilmodelle in einem Stück. Als AASX ist die Antwort eine Datei.",
    parameter: [
      {
        name: "aasIds",
        titel: "aasIds",
        ort: "query",
        art: "liste",
        hinweis: "Mehrere Kennungen durch Komma trennen. Werden bereits kodiert erwartet.",
      },
      {
        name: "submodelIds",
        titel: "submodelIds",
        ort: "query",
        art: "liste",
        hinweis: "Mehrere Kennungen durch Komma trennen.",
      },
      { name: "includeConceptDescriptions", titel: "includeConceptDescriptions", ort: "query", art: "schalter" },
      {
        name: "serializationFormat",
        titel: "serializationFormat",
        ort: "query",
        art: "auswahl",
        werte: ["JSON", "XML", "AASX"],
      },
    ],
    binaer: true,
  },
  {
    id: "submodel",
    gruppe: "SubmodelRepository",
    methode: "GET",
    vorlage: "/submodels/{submodelIdentifier}",
    beschreibung: "Ein Teilmodell unmittelbar.",
    parameter: [kennung("submodelIdentifier", "submodelIdentifier"), LEVEL, EXTENT],
  },
  {
    id: "submodel-element",
    gruppe: "SubmodelRepository",
    methode: "GET",
    vorlage: "/submodels/{submodelIdentifier}/submodel-elements/{idShortPath}",
    beschreibung: "Ein einzelnes Element innerhalb eines Teilmodells.",
    parameter: [
      kennung("submodelIdentifier", "submodelIdentifier"),
      {
        name: "idShortPath",
        titel: "idShortPath",
        ort: "pfad",
        art: "text",
        vorgabe: "Nameplate",
        hinweis: "Verschachtelte Pfade mit Punkt oder Schrägstrich, etwa Nameplate/ManufacturerName.",
      },
    ],
  },
  {
    id: "submodel-element-attachment",
    gruppe: "SubmodelRepository",
    methode: "GET",
    vorlage: "/submodels/{submodelIdentifier}/submodel-elements/{idShortPath}/attachment",
    beschreibung: "Die Datei an einem Element. Die Antwort ist eine Datei, kein JSON.",
    parameter: [
      kennung("submodelIdentifier", "submodelIdentifier"),
      {
        name: "idShortPath",
        titel: "idShortPath",
        ort: "pfad",
        art: "text",
        vorgabe: "Nameplate",
        hinweis: "Verschachtelte Pfade mit Punkt oder Schrägstrich.",
      },
    ],
    binaer: true,
  },
  {
    id: "discovery",
    gruppe: "Discovery",
    methode: "POST",
    vorlage: "/lookup/shellsByAssetLink",
    beschreibung:
      "Die neue Operation: zu einer globalAssetId die Kennungen der zugehörigen Verwaltungsschalen. Rechnet nur, fragt das Zielsystem nicht.",
    parameter: [
      { name: "limit", titel: "limit", ort: "query", art: "text", hinweis: "Höchstzahl der Treffer auf dieser Seite." },
      { name: "cursor", titel: "cursor", ort: "query", art: "text", hinweis: "Wert aus paging_metadata der vorigen Antwort." },
    ],
    koerperVorgabe: JSON.stringify([{ name: "globalAssetId", value: BEISPIEL_GLOBAL_ASSET_ID }], null, 2),
  },
];

/** Kennungen wandern base64url-kodiert in den Pfad, ohne Auffüllzeichen. */
export function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let roh = "";
  for (const byte of bytes) roh += String.fromCharCode(byte);
  return btoa(roh).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pfadwert(roh: string, istKennung: boolean, kodieren: boolean): string {
  // encodeURIComponent kommt immer zuletzt, damit ein Schrägstrich im
  // idShortPath als %2F ankommt und nicht als Trenner. Auf base64url wirkt es
  // folgenlos, dessen Alphabet ist bereits sicher.
  return encodeURIComponent(istKennung && kodieren ? base64url(roh) : roh);
}

export function urlBauen(aufruf: Aufruf, werte: Record<string, string>, kodieren: boolean): string {
  let pfad = aufruf.vorlage;
  for (const parameter of aufruf.parameter) {
    if (parameter.ort !== "pfad") continue;
    const roh = werte[parameter.name] ?? "";
    pfad = pfad.replace(`{${parameter.name}}`, pfadwert(roh, parameter.kennung === true, kodieren));
  }

  const anfrage = new URLSearchParams();
  for (const parameter of aufruf.parameter) {
    if (parameter.ort !== "query") continue;
    const roh = (werte[parameter.name] ?? "").trim();
    if (roh === "") continue;
    if (parameter.art === "liste") {
      for (const teil of roh.split(",").map((t) => t.trim()).filter((t) => t !== "")) {
        anfrage.append(parameter.name, teil);
      }
      continue;
    }
    anfrage.append(parameter.name, roh);
  }

  const angehaengt = anfrage.toString();
  return angehaengt === "" ? pfad : `${pfad}?${angehaengt}`;
}

/** Die Zeile zum Kopieren, damit sich ein Fund außerhalb nachstellen lässt. */
export function curlBauen(aufruf: Aufruf, url: string, basis: string, koerper: string, autorisierung: string): string {
  const teile = [`curl -i -X ${aufruf.methode} '${basis}${url}'`];
  if (autorisierung.trim() !== "") teile.push(`  -H 'authorization: ${autorisierung.trim()}'`);
  if (aufruf.methode === "POST") {
    teile.push("  -H 'content-type: application/json'");
    teile.push(`  -d '${koerper.replace(/\s+/g, " ").trim()}'`);
  }
  return teile.join(" \\\n");
}
