import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { zustaendigFuer } from "../aufloesung.js";
import { antwortUmschreiben, umschreibbar } from "../dateipfade.js";
import type { Einstellungen } from "../einstellungen.js";
import { ergebnis, type Uhr, echteUhr } from "../fehler.js";
import { AAS_MUSTER } from "../pfade.js";
import type { Proxys } from "../proxys.js";
import { proxyBasisAus } from "./swagger.js";

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

export function anfrageKopfzeilen(req: Request): Headers {
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
  proxys: Proxys;
  /** Fuer die oeffentliche Basis, auf die absolute Dateipfade zeigen. */
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
 *
 * Die eine Ausnahme ist je Proxy schaltbar und ab Werk aus: absolute
 * Dateipfade. Dann wird eine JSON-Antwort mit Status 200 eingelesen und ihre
 * relativen Dateipfade zeigen auf den Proxy. Alles andere geht weiter als
 * Strom durch.
 */
export function weiterleitung({
  proxys,
  einstellungen,
  holen = fetch,
  uhr = echteUhr,
}: WeiterleitungOptionen): RequestHandler {
  return async function weiterleiten(req: Request, res: Response, next: NextFunction): Promise<void> {
    const zustaendig = zustaendigFuer(req.originalUrl, proxys);
    if (zustaendig === null) return next();
    const { proxy, rest } = zustaendig;
    if (!AAS_MUSTER.some((muster) => muster.test(rest))) return next();

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).json(ergebnis("405", `Method ${req.method} is not allowed on this path.`, "Error", uhr));
      return;
    }

    const ziel = proxy.upstreamBasis + rest;
    const zeitlimit = proxy.zeitlimitMs;
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

      const umschreiben =
        proxy.dateiPfadeAbsolut &&
        req.method === "GET" &&
        oben.status === 200 &&
        /\bjson\b/i.test(oben.headers.get("content-type") ?? "") &&
        umschreibbar(rest);
      if (umschreiben) {
        const text = await oben.text();
        let koerper: unknown;
        try {
          koerper = JSON.parse(text);
        } catch {
          // Kein JSON, obwohl es so heisst: dann so, wie es kam.
          res.end(text);
          return;
        }
        // Der ETag von oben gehoert zum Koerper von oben, nicht zu diesem.
        res.removeHeader("etag");
        res.end(JSON.stringify(antwortUmschreiben(rest, koerper, proxyBasisAus(req, einstellungen, proxy))));
        return;
      }

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
