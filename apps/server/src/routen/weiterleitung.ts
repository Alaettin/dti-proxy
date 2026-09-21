import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Einstellungen } from "../einstellungen.js";
import { ergebnis, type Uhr, echteUhr } from "../fehler.js";
import { AAS_MUSTER } from "../pfade.js";

/**
 * Kopfzeilen, die zur einzelnen Verbindung gehoeren und deshalb nicht weiter
 * wandern duerfen. Alles andere geht durch, insbesondere Authorization.
 */
const ANFRAGE_AUS = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-authenticate",
  "proxy-authorization",
  "content-length",
]);

const ANTWORT_AUS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
]);

function anfrageKopfzeilen(req: Request): Headers {
  const kopfzeilen = new Headers();
  for (const [name, wert] of Object.entries(req.headers)) {
    if (wert === undefined || ANFRAGE_AUS.has(name.toLowerCase())) continue;
    if (Array.isArray(wert)) for (const einzeln of wert) kopfzeilen.append(name, einzeln);
    else kopfzeilen.set(name, wert);
  }
  return kopfzeilen;
}

function antwortKopfzeilenSetzen(antwort: Response, oben: globalThis.Response): void {
  const cookies = oben.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) antwort.setHeader("set-cookie", cookies);
  oben.headers.forEach((wert, name) => {
    const klein = name.toLowerCase();
    if (ANTWORT_AUS.has(klein) || klein === "set-cookie") return;
    antwort.setHeader(name, wert);
  });
}

export interface WeiterleitungOptionen {
  einstellungen: Einstellungen;
  holen?: typeof fetch;
  uhr?: Uhr;
}

/**
 * Reicht die zehn AAS-Pfade unveraendert nach oben durch.
 *
 * Kern der Sache: gearbeitet wird mit req.originalUrl, also der rohen Zeile aus
 * der Anfrage. Express-Parameterrouten wuerden base64url-IDs und ein %2F im
 * idShortPath dekodieren und beim Zusammensetzen anders wieder kodieren. Das
 * waere genau die Veraenderung, die dieses Projekt ausschliesst.
 */
export function weiterleitung({ einstellungen, holen = fetch, uhr = echteUhr }: WeiterleitungOptionen): RequestHandler {
  return async function weiterleiten(req: Request, res: Response, next: NextFunction): Promise<void> {
    const roh = req.originalUrl;
    if (!AAS_MUSTER.some((muster) => muster.test(roh))) return next();

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).json(ergebnis("405", `Method ${req.method} is not allowed on this path.`, "Error", uhr));
      return;
    }

    const ziel = einstellungen.lesen("upstreamBasis") + roh;
    const zeitlimit = einstellungen.zeitlimit();
    const abbruch = new AbortController();
    const wecker = setTimeout(() => abbruch.abort(), zeitlimit);

    try {
      const oben = await holen(ziel, {
        method: req.method,
        headers: anfrageKopfzeilen(req),
        redirect: "manual",
        signal: abbruch.signal,
      });

      res.status(oben.status);
      antwortKopfzeilenSetzen(res, oben);

      if (!oben.body || req.method === "HEAD") {
        res.end();
        return;
      }
      await pipeline(Readable.fromWeb(oben.body as Parameters<typeof Readable.fromWeb>[0]), res);
    } catch (fehler) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const abgebrochen = fehler instanceof Error && fehler.name === "AbortError";
      const text = abgebrochen
        ? `The target system did not answer within ${zeitlimit} ms.`
        : `The target system is not reachable: ${fehler instanceof Error ? fehler.message : String(fehler)}`;
      res.status(502).json(ergebnis("502", text, "Error", uhr));
    } finally {
      clearTimeout(wecker);
    }
  };
}
