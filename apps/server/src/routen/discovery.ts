import { Ajv, type ErrorObject } from "ajv";
import { Router, type Request, type Response } from "express";
import type { Einstellungen } from "../einstellungen.js";
import { ergebnisAus, type Uhr, echteUhr } from "../fehler.js";
import { DISCOVERY_PFAD } from "../pfade.js";

/** Der einzige Bezeichnername, den dieser Dienst bedient. */
export const GLOBAL_ASSET_ID = "globalAssetId";

/** Fassung der Discovery-Spezifikation. Der Wechsel auf V3.2 ist diese Zeile. */
export const DISCOVERY_FASSUNG = "3.1";
export const DISCOVERY_PROFIL =
  "https://admin-shell.io/aas/API/3/1/DiscoveryServiceSpecification/SSP-001";

const ajv = new Ajv({ allErrors: true, strict: false });

const SCHEMA = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    required: ["name", "value"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 64 },
      value: { type: "string", minLength: 1, maxLength: 2048 },
    },
  },
} as const;

const pruefen = ajv.compile(SCHEMA);

function feldName(fehler: ErrorObject): string {
  if (fehler.keyword === "required") return String(fehler.params.missingProperty);
  const teile = fehler.instancePath.split("/");
  return teile[teile.length - 1] ?? "";
}

/** Uebersetzt die Meldungen von ajv in die Satzform aus der Spezifikation. */
export function fehlertexte(fehler: ErrorObject[]): string[] {
  const texte = fehler.map((f) => {
    if (f.instancePath === "" && f.keyword === "type") {
      return "The request body must be a JSON array of asset links.";
    }
    if (f.instancePath === "" && f.keyword === "minItems") {
      return "The request body must contain at least one asset link.";
    }
    const feld = feldName(f);
    switch (f.keyword) {
      case "required":
        return `Property '${feld}' is required.`;
      case "type":
        return `Property '${feld}' must be a string.`;
      case "minLength":
      case "maxLength": {
        const grenze = feld === "name" ? 64 : 2048;
        return `Property '${feld}' must be between 1 and ${grenze} characters.`;
      }
      default:
        return `Property '${feld}' is invalid: ${f.message ?? f.keyword}.`;
    }
  });
  return [...new Set(texte)];
}

/**
 * Zieht die itemID aus einer globalAssetId.
 *
 * Zwei Formen kommen vor. Die der Anforderung, <schema><domain>/<itemID>, wo
 * die itemID das letzte Pfadsegment ist. Und die Zielform selbst,
 * <schema><domain>/aas?itemId=<itemID>, wo die itemID im Query-Teil steht und
 * das letzte Pfadsegment schlicht "aas" waere. Der Query-Teil hat Vorrang,
 * denn er benennt die itemID ausdruecklich, waehrend das Pfadsegment nur
 * geraten ist.
 *
 * Kein Treffer bedeutet kein Ergebnis, nicht Fehler: die Spezifikation
 * verlangt bei nicht Gefundenem 200 mit leerem result.
 */
export function itemIdAus(wert: string): string | null {
  let url: URL;
  try {
    url = new URL(wert);
  } catch {
    return null;
  }

  for (const [name, inhalt] of url.searchParams) {
    if (name.toLowerCase() !== "itemid") continue;
    const sauber = inhalt.trim();
    if (sauber !== "") return sauber;
  }

  const segmente = url.pathname.split("/").filter((teil) => teil.length > 0);
  const letztes = segmente[segmente.length - 1];
  if (letztes === undefined) return null;
  try {
    const dekodiert = decodeURIComponent(letztes);
    return dekodiert.length > 0 ? dekodiert : null;
  } catch {
    return letztes;
  }
}

export function aasIdBauen(aasBasis: string, itemId: string): string {
  return `${aasBasis}/aas?itemId=${encodeURIComponent(itemId)}`;
}

function versatzAus(cursor: unknown): number | null {
  if (cursor === undefined) return 0;
  if (typeof cursor !== "string" || cursor === "") return null;
  // Buffer.from wirft bei Muell nicht, sondern verschluckt die unbekannten
  // Zeichen. Deshalb Alphabet und Ergebnis ausdruecklich pruefen.
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const entpackt = Buffer.from(cursor, "base64url").toString("utf8");
  if (!/^\d+$/.test(entpackt)) return null;
  const zahl = Number(entpackt);
  return Number.isSafeInteger(zahl) ? zahl : null;
}

function cursorAus(versatz: number): string {
  return Buffer.from(String(versatz), "utf8").toString("base64url");
}

function grenzeAus(limit: unknown): number | null | "fehler" {
  if (limit === undefined) return null;
  if (typeof limit !== "string") return "fehler";
  const zahl = Number(limit);
  if (!Number.isInteger(zahl) || zahl < 1) return "fehler";
  return zahl;
}

export interface DiscoveryOptionen {
  einstellungen: Einstellungen;
  uhr?: Uhr;
}

export function discoveryRouter({ einstellungen, uhr = echteUhr }: DiscoveryOptionen): Router {
  const router = Router();

  router.post(DISCOVERY_PFAD, (req: Request, res: Response) => {
    const grenze = grenzeAus(req.query.limit);
    if (grenze === "fehler") {
      res.status(400).json(ergebnisAus("400", ["Query parameter 'limit' must be an integer of at least 1."], "Error", uhr));
      return;
    }

    const versatz = versatzAus(req.query.cursor);
    if (versatz === null) {
      res.status(400).json(ergebnisAus("400", ["Query parameter 'cursor' is not a valid cursor."], "Error", uhr));
      return;
    }

    if (!pruefen(req.body)) {
      res.status(400).json(ergebnisAus("400", fehlertexte(pruefen.errors ?? []), "Error", uhr));
      return;
    }

    const bezeichner = req.body as { name: string; value: string }[];
    const aasBasis = einstellungen.lesen("aasBasis");

    const gefunden: string[] = [];
    for (const eintrag of bezeichner) {
      if (eintrag.name !== GLOBAL_ASSET_ID) continue;
      const itemId = itemIdAus(eintrag.value);
      if (itemId === null) continue;
      const id = aasIdBauen(aasBasis, itemId);
      if (!gefunden.includes(id)) gefunden.push(id);
    }

    const ende = grenze === null ? gefunden.length : versatz + grenze;
    const seite = gefunden.slice(versatz, ende);
    const weitere = ende < gefunden.length;

    res.status(200).json({
      paging_metadata: weitere ? { cursor: cursorAus(ende) } : {},
      result: seite,
    });
  });

  return router;
}
