import type { NextFunction, Request, RequestHandler, Response } from "express";
import { zustaendigFuer } from "../aufloesung.js";
import { schaleUmschreiben } from "../dateipfade.js";
import type { Einstellungen } from "../einstellungen.js";
import { ergebnis, type Uhr, echteUhr } from "../fehler.js";
import { grenzeAus, seiteAus, versatzAus } from "../paging.js";
import { SHELLS_PFAD } from "../pfade.js";
import type { Proxys } from "../proxys.js";
import type { SchalenPuffer } from "../puffer.js";
import { base64urlAus, gefundeneSchalen, misserfolgBeantworten, schalenHolen } from "../schalen.js";
import { GLOBAL_ASSET_ID, itemIdAus } from "./discovery.js";
import { proxyBasisAus } from "./swagger.js";

/** Fassung und Profil der Repository-Spezifikation, nach der GET /shells gebaut ist. */
export const REPOSITORY_FASSUNG = "3.1";
export const REPOSITORY_PROFIL =
  "https://admin-shell.io/aas/API/3/1/AssetAdministrationShellRepositoryServiceSpecification/SSP-002";

/** Ohne limit nicht alles auf einmal: jeder Eintrag kann einen Aufruf oben kosten. */
export const SEITE_VORGABE = 100;

/**
 * Liest die assetIds. Jeder Wert ist eine base64url-kodierte SpecificAssetId.
 * Ausgewertet wird wie bei Discovery nur globalAssetId; andere Namen sind
 * gueltig, treffen aber nichts. Kaputte Werte sind ein Fehler des Aufrufers.
 */
export function gesuchteItemIds(roh: unknown): Set<string> | null | "fehler" {
  if (roh === undefined) return null;
  const werte = Array.isArray(roh) ? roh : [roh];
  const gesucht = new Set<string>();
  for (const wert of werte) {
    // Mit oder ohne Auffuellzeichen, beides kommt von Clients.
    if (typeof wert !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(wert)) return "fehler";
    let link: unknown;
    try {
      link = JSON.parse(Buffer.from(wert, "base64url").toString("utf8"));
    } catch {
      return "fehler";
    }
    if (typeof link !== "object" || link === null) return "fehler";
    const { name, value } = link as { name?: unknown; value?: unknown };
    if (typeof name !== "string" || typeof value !== "string") return "fehler";
    if (name !== GLOBAL_ASSET_ID) continue;
    const itemId = itemIdAus(value);
    if (itemId !== null) gesucht.add(itemId);
  }
  return gesucht;
}

export interface ShellsOptionen {
  proxys: Proxys;
  puffer: SchalenPuffer;
  einstellungen: Einstellungen;
  holen?: typeof fetch;
  uhr?: Uhr;
}

/**
 * GET /shells nach AAS Repository SSP-002. Die Zielsysteme kennen den Aufruf
 * nicht, deshalb bedient ihn der Proxy selbst: die Liste kommt aus den
 * gepflegten Item-IDs, jede Schale einzeln von oben ueber GET /shells/{id}.
 */
export function shells({ proxys, puffer, einstellungen, holen = fetch, uhr = echteUhr }: ShellsOptionen): RequestHandler {
  return async function shellsBedienen(req: Request, res: Response, next: NextFunction): Promise<void> {
    const zustaendig = zustaendigFuer(req.originalUrl, proxys);
    if (zustaendig === null) return next();
    const ohneQuery = zustaendig.rest.split("?")[0] ?? "";
    if (ohneQuery !== SHELLS_PFAD) return next();
    // Ausgeschaltet heisst: der Weg existiert fuer diesen Proxy nicht, wie vorher.
    if (!zustaendig.proxy.shellsAktiv) return next();
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).json(ergebnis("405", `Method ${req.method} is not allowed on this path.`, "Error", uhr));
      return;
    }

    const grenze = grenzeAus(req.query.limit);
    if (grenze === "fehler") {
      res.status(400).json(ergebnis("400", "Query parameter 'limit' must be an integer of at least 1.", "Error", uhr));
      return;
    }
    const versatz = versatzAus(req.query.cursor);
    if (versatz === null) {
      res.status(400).json(ergebnis("400", "Query parameter 'cursor' is not a valid cursor.", "Error", uhr));
      return;
    }
    const gesucht = gesuchteItemIds(req.query.assetIds);
    if (gesucht === "fehler") {
      res
        .status(400)
        .json(
          ergebnis("400", "Query parameter 'assetIds' must contain base64url-encoded SpecificAssetIds.", "Error", uhr),
        );
      return;
    }

    const { proxy } = zustaendig;
    const alle = proxys.itemIds(proxy.kennung) ?? [];
    const treffer = gesucht === null ? alle : alle.filter((itemId) => gesucht.has(itemId));
    const { seite, cursor } = seiteAus(treffer, versatz, grenze ?? SEITE_VORGABE);

    const ergebnisse = await schalenHolen({ proxy, proxyId: proxys.idVon(proxy.kennung), puffer, holen }, req, seite);
    if (misserfolgBeantworten(ergebnisse, res, uhr)) return;
    let schalen = gefundeneSchalen(ergebnisse);
    if (proxy.dateiPfadeAbsolut) {
      const proxyBasis = proxyBasisAus(req, einstellungen, proxy);
      schalen = schalen.map((schale) => {
        const id = (schale as { id?: unknown }).id;
        return typeof id === "string" ? schaleUmschreiben(schale, proxyBasis, base64urlAus(id)) : schale;
      });
    }
    res.status(200).json({ paging_metadata: cursor === undefined ? {} : { cursor }, result: schalen });
  };
}
