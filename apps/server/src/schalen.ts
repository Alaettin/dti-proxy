import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { GLEICHZEITIG, gedrosselt } from "./drossel.js";
import { ergebnis, type Uhr } from "./fehler.js";
import type { Proxy } from "./proxys.js";
import type { Auftrag, SchalenPuffer } from "./puffer.js";
import { aasIdBauen } from "./routen/discovery.js";
import { anfrageKopfzeilen } from "./routen/weiterleitung.js";

/**
 * Schalen einzeln von oben holen, mit Puffer. Geteilt von GET /shells, der
 * AAS Registry, der Submodel Registry und der Erneuerung im Hintergrund: alle
 * bilden ihre Liste aus denselben Item-IDs, und eine einmal geholte Schale
 * dient allen.
 */

/** Was beim Abruf einer einzelnen Schale oben herauskommt. */
export type Geholt =
  | { art: "schale"; schale: unknown }
  | { art: "fehlt" }
  | { art: "abgelehnt"; status: number; inhaltsart: string | null; koerper: string };

export class ObenFehler extends Error {}

export function base64urlAus(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** Gepuffert wird, was eine Schale ist oder sicher fehlt; Abweisungen nie. */
export function behalten(geholt: Geholt): boolean {
  return geholt.art !== "abgelehnt";
}

/** Fingerabdruck des Aufrufers. Ohne Authorization ist er fuer alle gleich, auch fuer die Erneuerung. */
function fingerabdruck(autorisierung: string | undefined): string {
  return createHash("sha256")
    .update(autorisierung ?? "")
    .digest("base64url");
}

function schluesselFuer(proxy: Proxy, itemId: string, autorisierung: string | undefined): string {
  return `${aasIdBauen(proxy.aasBasis, itemId)}\n${fingerabdruck(autorisierung)}`;
}

/** Holt eine Schale oben, ohne Puffer. */
export async function schaleLaden(
  proxy: Proxy,
  aasId: string,
  kopfzeilen: Headers,
  holen: typeof fetch,
): Promise<Geholt> {
  const ziel = `${proxy.upstreamBasis}/shells/${base64urlAus(aasId)}`;
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), proxy.zeitlimitMs);
  try {
    const oben = await holen(ziel, { method: "GET", headers: kopfzeilen, redirect: "manual", signal: abbruch.signal });
    const text = await oben.text();
    if (oben.status === 404) return { art: "fehlt" };
    if (oben.status === 401 || oben.status === 403) {
      return { art: "abgelehnt", status: oben.status, inhaltsart: oben.headers.get("content-type"), koerper: text };
    }
    if (oben.status !== 200) throw new ObenFehler(`The target system answered ${oben.status} for ${aasId}.`);
    try {
      return { art: "schale", schale: JSON.parse(text) as unknown };
    } catch {
      throw new ObenFehler(`The target system did not answer with JSON for ${aasId}.`);
    }
  } catch (fehler) {
    if (fehler instanceof ObenFehler) throw fehler;
    const abgebrochen = fehler instanceof Error && fehler.name === "AbortError";
    throw new ObenFehler(
      abgebrochen
        ? `The target system did not answer within ${proxy.zeitlimitMs} ms.`
        : `The target system is not reachable: ${fehler instanceof Error ? fehler.message : String(fehler)}`,
    );
  } finally {
    clearTimeout(wecker);
  }
}

/** Die Auftraege, mit denen die Erneuerung alle Schalen eines Proxys anonym laedt. */
export function erneuerungsAuftraege(proxy: Proxy, itemIds: string[], holen: typeof fetch): Auftrag<Geholt>[] {
  return itemIds.map((itemId) => ({
    schluessel: schluesselFuer(proxy, itemId, undefined),
    laden: () => schaleLaden(proxy, aasIdBauen(proxy.aasBasis, itemId), new Headers(), holen),
  }));
}

export interface SchalenQuelle {
  proxy: Proxy;
  /** Innere Nummer des Proxys, Schluessel fuer den Puffer. Ohne sie wird nicht gepuffert. */
  proxyId: number | null;
  puffer: SchalenPuffer;
  holen: typeof fetch;
}

/** Holt die Schalen zu den Item-IDs, gedrosselt und ueber den Puffer. */
export async function schalenHolen(
  { proxy, proxyId, puffer, holen }: SchalenQuelle,
  req: Request,
  itemIds: string[],
): Promise<PromiseSettledResult<Geholt>[]> {
  const kopfzeilen = anfrageKopfzeilen(req);
  const autorisierung = req.headers.authorization;
  const aufgaben = itemIds.map((itemId) => () => {
    const laden = (): Promise<Geholt> => schaleLaden(proxy, aasIdBauen(proxy.aasBasis, itemId), kopfzeilen, holen);
    if (proxyId === null) return laden();
    return puffer.holen(proxyId, schluesselFuer(proxy, itemId, autorisierung), proxy.pufferStunden > 0, laden, behalten);
  });
  return gedrosselt(aufgaben, GLEICHZEITIG);
}

/**
 * Beantwortet die Anfrage, wenn eines der Ergebnisse kein Erfolg ist, und
 * meldet das mit true. Abgewiesen gilt fuer den ganzen Aufruf, mit der Antwort
 * von oben, damit der Aufrufer sieht, was ihm fehlt. Alles andere ist 502.
 */
export function misserfolgBeantworten(
  ergebnisse: PromiseSettledResult<Geholt>[],
  res: Response,
  uhr: Uhr,
): boolean {
  for (const eins of ergebnisse) {
    if (eins.status === "fulfilled" && eins.value.art === "abgelehnt") {
      res.status(eins.value.status);
      if (eins.value.inhaltsart !== null) res.setHeader("Content-Type", eins.value.inhaltsart);
      res.send(eins.value.koerper);
      return true;
    }
  }
  const fehler = ergebnisse.find((eins) => eins.status === "rejected");
  if (fehler !== undefined) {
    const grund = (fehler as PromiseRejectedResult).reason as unknown;
    const text = grund instanceof ObenFehler ? grund.message : "Internal proxy error.";
    res.status(502).json(ergebnis("502", text, "Error", uhr));
    return true;
  }
  return false;
}

/** Die gefundenen Schalen in Reihenfolge, fehlende fallen weg. Nur nach misserfolgBeantworten aufrufen. */
export function gefundeneSchalen(ergebnisse: PromiseSettledResult<Geholt>[]): unknown[] {
  const schalen: unknown[] = [];
  for (const eins of ergebnisse) {
    if (eins.status === "fulfilled" && eins.value.art === "schale") schalen.push(eins.value.schale);
  }
  return schalen;
}
