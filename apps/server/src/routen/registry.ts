import type { NextFunction, Request, RequestHandler, Response } from "express";
import { zustaendigFuer } from "../aufloesung.js";
import type { Einstellungen } from "../einstellungen.js";
import { ergebnis, type Uhr, echteUhr } from "../fehler.js";
import { grenzeAus, seiteAus, versatzAus } from "../paging.js";
import { REGISTRY_PFAD } from "../pfade.js";
import type { Proxys } from "../proxys.js";
import type { SchalenPuffer } from "../puffer.js";
import { base64urlAus, gefundeneSchalen, misserfolgBeantworten, schalenHolen } from "../schalen.js";
import { aasIdBauen, itemIdAus } from "./discovery.js";
import { SEITE_VORGABE } from "./shells.js";
import { proxyBasisAus } from "./swagger.js";

/** Fassung und Profil der Registry-Spezifikation, nach der beide Wege gebaut sind. */
export const REGISTRY_FASSUNG = "3.1";
export const REGISTRY_PROFIL =
  "https://admin-shell.io/aas/API/3/1/AssetAdministrationShellRegistryServiceSpecification/SSP-002";

/** AssetKind aus Part 1 V3.1. */
export const ASSET_KINDS = ["Instance", "NotApplicable", "Role", "Type"] as const;

export type Objekt = Record<string, unknown>;

function istObjekt(wert: unknown): wert is Objekt {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function endpunkt(schnittstelle: string, href: string): Objekt {
  // Das Schema der Basis sagt, wie der Aufrufer den Proxy erreicht.
  const protokoll = href.startsWith("https:") ? "HTTPS" : "HTTP";
  return {
    interface: schnittstelle,
    protocolInformation: { href, endpointProtocol: protokoll, endpointProtocolVersion: ["1.1"] },
  };
}

/**
 * Baut aus einer Schale von oben ihren AssetAdministrationShellDescriptor.
 * Die Endpunkte zeigen auf den Proxy, der die Schale und ihre Teilmodelle
 * unveraendert durchreicht. Nur vorhandene Felder werden gesetzt. Ohne
 * Kennung ist es keine Schale: dann null.
 */
export function descriptorAus(schale: unknown, proxyBasis: string): Objekt | null {
  if (!istObjekt(schale) || typeof schale.id !== "string" || schale.id === "") return null;
  const id = schale.id;
  const descriptor: Objekt = { id };

  for (const feld of ["idShort", "administration", "description", "displayName"] as const) {
    if (schale[feld] !== undefined) descriptor[feld] = schale[feld];
  }
  const asset = istObjekt(schale.assetInformation) ? schale.assetInformation : {};
  for (const feld of ["assetKind", "assetType", "globalAssetId", "specificAssetIds"] as const) {
    if (asset[feld] !== undefined) descriptor[feld] = asset[feld];
  }

  descriptor.endpoints = [endpunkt("AAS-3.0", `${proxyBasis}/shells/${base64urlAus(id)}`)];

  const teilmodelle = teilmodellDescriptoren(schale, proxyBasis);
  if (teilmodelle.length > 0) descriptor.submodelDescriptors = teilmodelle;

  return descriptor;
}

/**
 * Die SubmodelDescriptoren einer Schale, allein aus ihren Verweisen: id,
 * semanticId und ein Endpunkt auf den Proxy. Kein Aufruf je Teilmodell oben.
 * Geteilt von der AAS Registry und der Submodel Registry.
 */
export function teilmodellDescriptoren(schale: unknown, proxyBasis: string): Objekt[] {
  if (!istObjekt(schale)) return [];
  const teilmodelle: Objekt[] = [];
  for (const verweis of Array.isArray(schale.submodels) ? schale.submodels : []) {
    if (!istObjekt(verweis) || !Array.isArray(verweis.keys)) continue;
    const schluessel: unknown = verweis.keys[0];
    if (!istObjekt(schluessel) || schluessel.type !== "Submodel" || typeof schluessel.value !== "string") continue;
    const teilmodell: Objekt = { id: schluessel.value };
    if (istObjekt(verweis.referredSemanticId)) teilmodell.semanticId = verweis.referredSemanticId;
    teilmodell.endpoints = [endpunkt("SUBMODEL-3.0", `${proxyBasis}/submodels/${base64urlAus(schluessel.value)}`)];
    teilmodelle.push(teilmodell);
  }
  return teilmodelle;
}

/** Ein base64url-Wert aus der Anfrage, mit oder ohne Auffuellzeichen, auch als %3D. */
export function base64urlLesen(roh: string): string | null {
  const ohneFuellung = roh.replace(/(=|%3D){1,2}$/i, "");
  if (!/^[A-Za-z0-9_-]+$/.test(ohneFuellung)) return null;
  const text = Buffer.from(ohneFuellung, "base64url").toString("utf8");
  return text === "" ? null : text;
}

export interface RegistryOptionen {
  proxys: Proxys;
  puffer: SchalenPuffer;
  einstellungen: Einstellungen;
  holen?: typeof fetch;
  uhr?: Uhr;
}

/**
 * GET /shell-descriptors und GET /shell-descriptors/{aasIdentifier} nach AAS
 * Registry SSP-002. Die Zielsysteme haben keine Registry. Registriert ist,
 * was in den Item-IDs des Proxys steht; die Descriptoren entstehen aus den
 * Schalen von oben, ueber denselben Puffer wie GET /shells.
 */
export function registry({
  proxys,
  puffer,
  einstellungen,
  holen = fetch,
  uhr = echteUhr,
}: RegistryOptionen): RequestHandler {
  return async function registryBedienen(req: Request, res: Response, next: NextFunction): Promise<void> {
    const zustaendig = zustaendigFuer(req.originalUrl, proxys);
    if (zustaendig === null) return next();
    const ohneQuery = zustaendig.rest.split("?")[0] ?? "";
    const liste = ohneQuery === REGISTRY_PFAD;
    // Das Segment roh, wie es in der Anfrage stand. Unterwege wie
    // /submodel-descriptors bedient dieser Proxy nicht.
    const segment = ohneQuery.startsWith(`${REGISTRY_PFAD}/`) ? ohneQuery.slice(REGISTRY_PFAD.length + 1) : null;
    if (!liste && (segment === null || segment === "" || segment.includes("/"))) return next();
    // Ausgeschaltet heisst: der Weg existiert fuer diesen Proxy nicht.
    if (!zustaendig.proxy.registryAktiv) return next();
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).json(ergebnis("405", `Method ${req.method} is not allowed on this path.`, "Error", uhr));
      return;
    }

    const { proxy } = zustaendig;
    const quelle = { proxy, proxyId: proxys.idVon(proxy.kennung), puffer, holen };
    const proxyBasis = proxyBasisAus(req, einstellungen, proxy);
    const itemIds = proxys.itemIds(proxy.kennung) ?? [];

    if (segment !== null) {
      const aasId = base64urlLesen(segment);
      if (aasId === null) {
        res.status(400).json(ergebnis("400", "The aasIdentifier must be base64url-encoded.", "Error", uhr));
        return;
      }
      const nichtRegistriert = (): void => {
        res
          .status(404)
          .json(ergebnis("404", `No Asset Administration Shell Descriptor with id '${aasId}' is registered.`, "Error", uhr));
      };
      const itemId = itemIdAus(aasId);
      if (itemId === null || !itemIds.includes(itemId)) return nichtRegistriert();

      const ergebnisse = await schalenHolen(quelle, req, [itemId]);
      if (misserfolgBeantworten(ergebnisse, res, uhr)) return;
      const [schale] = gefundeneSchalen(ergebnisse);
      if (schale === undefined) return nichtRegistriert();
      const descriptor = descriptorAus(schale, proxyBasis);
      if (descriptor === null) {
        res.status(502).json(ergebnis("502", `The target system did not answer with a shell for ${aasId}.`, "Error", uhr));
        return;
      }
      // Nur die erzeugte Kennung oder die, die die Schale selbst meldet. Eine
      // fremde Basis mit passender itemID ist eine andere Schale.
      if (aasId !== aasIdBauen(proxy.aasBasis, itemId) && aasId !== descriptor.id) return nichtRegistriert();
      res.status(200).json(descriptor);
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
    const assetKind = req.query.assetKind;
    if (assetKind !== undefined && !(ASSET_KINDS as readonly unknown[]).includes(assetKind)) {
      res
        .status(400)
        .json(ergebnis("400", `Query parameter 'assetKind' must be one of ${ASSET_KINDS.join(", ")}.`, "Error", uhr));
      return;
    }
    let assetType: string | undefined;
    if (req.query.assetType !== undefined) {
      const gelesen = typeof req.query.assetType === "string" ? base64urlLesen(req.query.assetType) : null;
      if (gelesen === null) {
        res.status(400).json(ergebnis("400", "Query parameter 'assetType' must be base64url-encoded.", "Error", uhr));
        return;
      }
      assetType = gelesen;
    }
    const gefiltert = assetKind !== undefined || assetType !== undefined;

    // Ohne Filter nur die Schalen der Seite holen. Mit Filter entscheidet erst
    // die Schale, ob sie dazugehoert, also alle holen und danach blaettern.
    const seite = gefiltert ? null : seiteAus(itemIds, versatz, grenze ?? SEITE_VORGABE);
    const ergebnisse = await schalenHolen(quelle, req, seite?.seite ?? itemIds);
    if (misserfolgBeantworten(ergebnisse, res, uhr)) return;

    const descriptoren: Objekt[] = [];
    for (const schale of gefundeneSchalen(ergebnisse)) {
      const descriptor = descriptorAus(schale, proxyBasis);
      if (descriptor === null) {
        res.status(502).json(ergebnis("502", "The target system did not answer with a shell.", "Error", uhr));
        return;
      }
      descriptoren.push(descriptor);
    }

    if (seite !== null) {
      res
        .status(200)
        .json({ paging_metadata: seite.cursor === undefined ? {} : { cursor: seite.cursor }, result: descriptoren });
      return;
    }
    const passend = descriptoren.filter(
      (descriptor) =>
        (assetKind === undefined || descriptor.assetKind === assetKind) &&
        (assetType === undefined || descriptor.assetType === assetType),
    );
    const { seite: treffer, cursor } = seiteAus(passend, versatz, grenze ?? SEITE_VORGABE);
    res.status(200).json({ paging_metadata: cursor === undefined ? {} : { cursor }, result: treffer });
  };
}
