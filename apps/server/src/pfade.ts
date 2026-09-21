/**
 * Die zehn lesenden AAS-Pfade, die dieser Proxy unveraendert weiterreicht.
 *
 * Die Liste steht hier fest und wird nicht zur Laufzeit aus der Spec von oben
 * gezogen: sonst haenge die erlaubte Angriffsflaeche des Proxys an einer Datei,
 * die jemand anders aendert. Stattdessen prueft ein Test, dass diese Liste mit
 * den Pfaden in spec/aas.swagger.json uebereinstimmt. Weicht oben etwas ab,
 * faellt der Test um, statt dass es niemand merkt.
 */
export const AAS_PFADE = [
  "/shells/{aasIdentifier}",
  "/shells/{aasIdentifier}/asset-information",
  "/shells/{aasIdentifier}/asset-information/thumbnail",
  "/shells/{aasIdentifier}/submodel-refs",
  "/shells/{aasIdentifier}/submodels/{submodelIdentifier}",
  "/description",
  "/serialization",
  "/submodels/{submodelIdentifier}",
  "/submodels/{submodelIdentifier}/submodel-elements/{idShortPath}",
  "/submodels/{submodelIdentifier}/submodel-elements/{idShortPath}/attachment",
] as const;

export const DISCOVERY_PFAD = "/lookup/shellsByAssetLink";

function maskieren(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Baut aus einer Pfadvorlage einen Ausdruck, der gegen den **rohen** Pfad
 * geprueft wird. Ein Platzhalter matcht alles ausser / ? #. Prozentfolgen wie
 * %2F bleiben dabei ein Zeichenpaar und werden nicht als Trenner gelesen.
 */
export function zuMuster(vorlage: string): RegExp {
  const teile = vorlage
    .split("/")
    .filter((teil) => teil.length > 0)
    .map((teil) => (teil.startsWith("{") && teil.endsWith("}") ? "[^/?#]+" : maskieren(teil)));
  return new RegExp(`^/${teile.join("/")}(?:\\?[^#]*)?$`);
}

export const AAS_MUSTER: RegExp[] = AAS_PFADE.map(zuMuster);

export function istAasPfad(rohePfadUndQuery: string): boolean {
  return AAS_MUSTER.some((muster) => muster.test(rohePfadUndQuery));
}
