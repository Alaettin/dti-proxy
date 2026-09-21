import type { Proxy, Proxys } from "./proxys.js";

export const PRAEFIX = "/p/";

export interface Zustaendigkeit {
  proxy: Proxy;
  /** Der Pfad hinter der Basis, roh und unangetastet. */
  rest: string;
  /** Der Teil davor, also "/p/<kennung>". */
  basisPfad: string;
}

/**
 * Bestimmt aus der rohen Anfragezeile, welcher Proxy zustaendig ist und was
 * vom Pfad uebrig bleibt.
 *
 * Alle Proxys sind gleich, keiner liegt an der Wurzel. Passt die Zeile nicht
 * auf `/p/<kennung>` einer bekannten Kennung, ist niemand zustaendig.
 *
 * Der Rest wird per slice abgeschnitten, nie zerlegt und neu zusammengesetzt.
 * Das ist dieselbe Regel wie in der Weiterleitung: eine base64url-Kennung oder
 * ein %2F im idShortPath darf hier nicht verlorengehen.
 */
export function zustaendigFuer(roheZeile: string, proxys: Proxys): Zustaendigkeit | null {
  if (!roheZeile.startsWith(PRAEFIX)) return null;

  const nachPraefix = roheZeile.slice(PRAEFIX.length);
  const ende = nachPraefix.search(/[/?#]/);
  const kennung = ende === -1 ? nachPraefix : nachPraefix.slice(0, ende);
  if (kennung === "") return null;

  const proxy = proxys.nachKennung(kennung);
  if (proxy === null) return null;

  const basisPfad = PRAEFIX + kennung;
  return { proxy, rest: roheZeile.slice(basisPfad.length), basisPfad };
}

/** Die oeffentliche Basis genau dieses Proxys. */
export function basisUrl(dienstBasis: string, proxy: Proxy): string {
  return dienstBasis + PRAEFIX + proxy.kennung;
}
