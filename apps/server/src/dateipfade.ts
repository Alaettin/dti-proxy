/**
 * Macht relative Dateipfade in Antworten zu absoluten Adressen dieses Proxys.
 *
 * Die Zielsysteme melden in File-Elementen nur Werte wie /aasx/suppl/logo.png,
 * im Vorschaubild ebenso. Die Datei selbst liefern sie aber ueber
 * .../submodel-elements/{idShortPath}/attachment und
 * .../asset-information/thumbnail. Genau dorthin zeigt der umgeschriebene Wert,
 * und zwar ueber den Proxy, wie bei den Endpunkten der Registry.
 *
 * Die Kennungen kommen roh aus der Anfragezeile und werden nie dekodiert: das
 * ist dieselbe Regel wie in der Weiterleitung. Nur die Teile, die hier neu
 * entstehen (idShort, Listenindex), laufen durch encodeURIComponent.
 */

type Objekt = Record<string, unknown>;

const SCHALE = /^\/shells\/([^/?#]+)$/;
const ASSET_INFORMATION = /^\/shells\/([^/?#]+)\/asset-information$/;
const TEILMODELL_DER_SCHALE = /^\/shells\/[^/?#]+\/submodels\/([^/?#]+)$/;
const TEILMODELL = /^\/submodels\/([^/?#]+)$/;
const ELEMENT = /^\/submodels\/([^/?#]+)\/submodel-elements\/([^/?#]+)$/;

function istObjekt(wert: unknown): wert is Objekt {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

/** Relativ ist, was weder ein Schema noch eine eigene Gegenstelle (//host) traegt. */
export function istRelativ(wert: unknown): wert is string {
  return typeof wert === "string" && wert !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(wert) && !wert.startsWith("//");
}

/**
 * Schreibt ein Element und alles darunter um. `adresse` ist die Adresse des
 * Elements bis einschliesslich seines idShortPath, ohne /attachment.
 */
function elementUmschreiben(element: unknown, adresse: string): void {
  if (!istObjekt(element)) return;
  switch (element.modelType) {
    case "File":
      if (istRelativ(element.value)) element.value = `${adresse}/attachment`;
      return;
    case "SubmodelElementCollection":
      kinderUmschreiben(element.value, adresse);
      return;
    case "Entity":
      kinderUmschreiben(element.statements, adresse);
      return;
    case "SubmodelElementList":
      // In einer Liste traegt das Element seinen Platz, nicht seinen idShort.
      if (Array.isArray(element.value)) {
        element.value.forEach((kind, index) => elementUmschreiben(kind, adresse + encodeURIComponent(`[${index}]`)));
      }
      return;
  }
}

function kinderUmschreiben(kinder: unknown, adresse: string): void {
  if (!Array.isArray(kinder)) return;
  for (const kind of kinder) {
    if (istObjekt(kind) && typeof kind.idShort === "string") {
      elementUmschreiben(kind, adresse + encodeURIComponent(`.${kind.idShort}`));
    }
  }
}

function teilmodellUmschreiben(teilmodell: unknown, elementeBasis: string): void {
  if (!istObjekt(teilmodell) || !Array.isArray(teilmodell.submodelElements)) return;
  for (const element of teilmodell.submodelElements) {
    if (istObjekt(element) && typeof element.idShort === "string") {
      elementUmschreiben(element, elementeBasis + encodeURIComponent(element.idShort));
    }
  }
}

function vorschaubildUmschreiben(assetInformation: unknown, adresse: string): void {
  if (!istObjekt(assetInformation) || !istObjekt(assetInformation.defaultThumbnail)) return;
  const bild = assetInformation.defaultThumbnail;
  if (istRelativ(bild.path)) bild.path = adresse;
}

/** Die Adresse, unter der der Proxy das Vorschaubild einer Schale ausliefert. */
export function vorschaubildAdresse(proxyBasis: string, aasRoh: string): string {
  return `${proxyBasis}/shells/${aasRoh}/asset-information/thumbnail`;
}

/** Eine Kopie der Schale mit absolutem Vorschaubild. Das Original bleibt, wie es ist (es kann gepuffert sein). */
export function schaleUmschreiben(schale: unknown, proxyBasis: string, aasRoh: string): unknown {
  const kopie = structuredClone(schale);
  if (istObjekt(kopie)) vorschaubildUmschreiben(kopie.assetInformation, vorschaubildAdresse(proxyBasis, aasRoh));
  return kopie;
}

function ohneQuery(rest: string): string {
  const ende = rest.indexOf("?");
  return ende === -1 ? rest : rest.slice(0, ende);
}

/** Ob die Antwort auf diesen Pfad Dateipfade enthalten kann. Nur dann lohnt sich das Einlesen. */
export function umschreibbar(rest: string): boolean {
  const pfad = ohneQuery(rest);
  return [SCHALE, ASSET_INFORMATION, TEILMODELL_DER_SCHALE, TEILMODELL, ELEMENT].some((muster) => muster.test(pfad));
}

/**
 * Schreibt die Antwort auf einen der durchgereichten Pfade um und gibt eine
 * Kopie zurueck. `rest` ist der rohe Pfad hinter /p/<kennung>.
 */
export function antwortUmschreiben(rest: string, koerper: unknown, proxyBasis: string): unknown {
  const pfad = ohneQuery(rest);
  const kopie = structuredClone(koerper);
  if (!istObjekt(kopie)) return kopie;

  let treffer = SCHALE.exec(pfad);
  if (treffer) {
    vorschaubildUmschreiben(kopie.assetInformation, vorschaubildAdresse(proxyBasis, treffer[1] ?? ""));
    return kopie;
  }
  treffer = ASSET_INFORMATION.exec(pfad);
  if (treffer) {
    vorschaubildUmschreiben(kopie, vorschaubildAdresse(proxyBasis, treffer[1] ?? ""));
    return kopie;
  }
  // Auch das Teilmodell unter einer Schale verweist fuer die Datei auf den
  // eigenstaendigen Pfad: /shells/{id}/submodels/{id}/submodel-elements gibt
  // es unter den durchgereichten Pfaden nicht.
  treffer = TEILMODELL_DER_SCHALE.exec(pfad) ?? TEILMODELL.exec(pfad);
  if (treffer) {
    teilmodellUmschreiben(kopie, `${proxyBasis}/submodels/${treffer[1] ?? ""}/submodel-elements/`);
    return kopie;
  }
  treffer = ELEMENT.exec(pfad);
  if (treffer) {
    elementUmschreiben(kopie, `${proxyBasis}/submodels/${treffer[1] ?? ""}/submodel-elements/${treffer[2] ?? ""}`);
  }
  return kopie;
}
