import type { Proxy, Proxys } from "./proxys.js";

export const PRAEFIX = "/p/";

export interface Zustaendigkeit {
  proxy: Proxy;
  /** Der Pfad hinter der Basis, roh und unangetastet. */
  rest: string;
  /** Der Teil vor dem Rest, "" beim Standard an der Wurzel. */
  basisPfad: string;
  /** Wurde der Proxy ueber /p/<kennung> angesprochen? */
  benannt: boolean;
}

/**
 * Bestimmt aus der rohen Anfragezeile, welcher Proxy zustaendig ist und was
 * vom Pfad uebrig bleibt.
 *
 * Der Rest wird per slice abgeschnitten, nie zerlegt und neu zusammengesetzt.
 * Das ist dieselbe Regel wie in der Weiterleitung: eine base64url-Kennung oder
 * ein %2F im idShortPath darf hier nicht verlorengehen.
 */
export function zustaendigFuer(roheZeile: string, proxys: Proxys): Zustaendigkeit | null {
  if (roheZeile.startsWith(PRAEFIX)) {
    const nachPraefix = roheZeile.slice(PRAEFIX.length);
    const ende = nachPraefix.search(/[/?#]/);
    const kennung = ende === -1 ? nachPraefix : nachPraefix.slice(0, ende);
    if (kennung === "") return null;
    const proxy = proxys.nachKennung(kennung);
    if (proxy === null) return null;
    const basisPfad = PRAEFIX + kennung;
    return { proxy, rest: roheZeile.slice(basisPfad.length), basisPfad, benannt: true };
  }

  const standard = proxys.standard();
  if (standard === null) return null;
  return { proxy: standard, rest: roheZeile, basisPfad: "", benannt: false };
}

/** Die oeffentliche Basis genau dieses Proxys. */
export function basisUrl(proxyBasis: string, proxy: Proxy): string {
  return proxy.standard ? proxyBasis : proxyBasis + PRAEFIX + proxy.kennung;
}
