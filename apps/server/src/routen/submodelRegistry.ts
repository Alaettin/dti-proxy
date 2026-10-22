import type { NextFunction, Request, RequestHandler, Response } from "express";
import { zustaendigFuer } from "../aufloesung.js";
import type { Einstellungen } from "../einstellungen.js";
import { ergebnis, type Uhr, echteUhr } from "../fehler.js";
import { grenzeAus, seiteAus, versatzAus } from "../paging.js";
import { SUBMODEL_REGISTRY_PFAD } from "../pfade.js";
import type { Proxys } from "../proxys.js";
import type { SchalenPuffer } from "../puffer.js";
import { gefundeneSchalen, misserfolgBeantworten, schalenHolen } from "../schalen.js";
import { base64urlLesen, type Objekt, teilmodellDescriptoren } from "./registry.js";
import { SEITE_VORGABE } from "./shells.js";
import { proxyBasisAus } from "./swagger.js";

/** Fassung und Profil der Submodel-Registry-Spezifikation. */
export const SUBMODEL_REGISTRY_FASSUNG = "3.1";
export const SUBMODEL_REGISTRY_PROFIL =
  "https://admin-shell.io/aas/API/3/1/SubmodelRegistryServiceSpecification/SSP-002";

export interface SubmodelRegistryOptionen {
  proxys: Proxys;
  puffer: SchalenPuffer;
  einstellungen: Einstellungen;
  holen?: typeof fetch;
  uhr?: Uhr;
}

/**
 * GET /submodel-descriptors und GET /submodel-descriptors/{submodelIdentifier}
 * nach Submodel Registry SSP-002. Registriert sind die Teilmodelle, auf die
 * die Schalen der gepflegten Item-IDs verweisen. Die Descriptoren entstehen
 * allein aus diesen Verweisen, ueber denselben Bestand wie GET /shells.
 */
export function submodelRegistry({
  proxys,
  puffer,
  einstellungen,
  holen = fetch,
  uhr = echteUhr,
}: SubmodelRegistryOptionen): RequestHandler {
  return async function submodelRegistryBedienen(req: Request, res: Response, next: NextFunction): Promise<void> {
    const zustaendig = zustaendigFuer(req.originalUrl, proxys);
    if (zustaendig === null) return next();
    const ohneQuery = zustaendig.rest.split("?")[0] ?? "";
    const liste = ohneQuery === SUBMODEL_REGISTRY_PFAD;
    // Das Segment roh, wie es in der Anfrage stand.
    const segment = ohneQuery.startsWith(`${SUBMODEL_REGISTRY_PFAD}/`)
      ? ohneQuery.slice(SUBMODEL_REGISTRY_PFAD.length + 1)
      : null;
    if (!liste && (segment === null || segment === "" || segment.includes("/"))) return next();
    // Ausgeschaltet heisst: der Weg existiert fuer diesen Proxy nicht.
    if (!zustaendig.proxy.submodelRegistryAktiv) return next();
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).json(ergebnis("405", `Method ${req.method} is not allowed on this path.`, "Error", uhr));
      return;
    }

    let smId: string | null = null;
    let grenze: number | null = null;
    let versatz = 0;
    if (segment !== null) {
      smId = base64urlLesen(segment);
      if (smId === null) {
        res.status(400).json(ergebnis("400", "The submodelIdentifier must be base64url-encoded.", "Error", uhr));
        return;
      }
    } else {
      const gelesen = grenzeAus(req.query.limit);
      if (gelesen === "fehler") {
        res.status(400).json(ergebnis("400", "Query parameter 'limit' must be an integer of at least 1.", "Error", uhr));
        return;
      }
      const gelesenerVersatz = versatzAus(req.query.cursor);
      if (gelesenerVersatz === null) {
        res.status(400).json(ergebnis("400", "Query parameter 'cursor' is not a valid cursor.", "Error", uhr));
        return;
      }
      grenze = gelesen;
      versatz = gelesenerVersatz;
    }

    // Welche Teilmodelle es gibt, steht erst in den Schalen: also alle holen,
    // im Normalfall aus dem Bestand der Erneuerung.
    const { proxy } = zustaendig;
    const itemIds = proxys.itemIds(proxy.kennung) ?? [];
    const quelle = { proxy, proxyId: proxys.idVon(proxy.kennung), puffer, holen };
    const ergebnisse = await schalenHolen(quelle, req, itemIds);
    if (misserfolgBeantworten(ergebnisse, res, uhr)) return;

    const proxyBasis = proxyBasisAus(req, einstellungen, proxy);
    const descriptoren: Objekt[] = [];
    const gesehen = new Set<unknown>();
    for (const schale of gefundeneSchalen(ergebnisse)) {
      for (const descriptor of teilmodellDescriptoren(schale, proxyBasis)) {
        // Verweisen zwei Schalen auf dasselbe Teilmodell, steht es einmal da.
        if (gesehen.has(descriptor.id)) continue;
        gesehen.add(descriptor.id);
        descriptoren.push(descriptor);
      }
    }

    if (smId !== null) {
      const gefunden = descriptoren.find((descriptor) => descriptor.id === smId);
      if (gefunden === undefined) {
        res
          .status(404)
          .json(ergebnis("404", `No Submodel Descriptor with id '${smId}' is registered.`, "Error", uhr));
        return;
      }
      res.status(200).json(gefunden);
      return;
    }

    const { seite, cursor } = seiteAus(descriptoren, versatz, grenze ?? SEITE_VORGABE);
    res.status(200).json({ paging_metadata: cursor === undefined ? {} : { cursor }, result: seite });
  };
}
