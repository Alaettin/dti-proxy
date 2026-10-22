/**
 * Blaettern nach der AAS-Spezifikation: limit und cursor als Query-Parameter,
 * der Cursor ist hier schlicht ein base64url-kodierter Versatz. Geteilt von
 * Discovery und GET /shells.
 */

export function versatzAus(cursor: unknown): number | null {
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

export function cursorAus(versatz: number): string {
  return Buffer.from(String(versatz), "utf8").toString("base64url");
}

export function grenzeAus(limit: unknown): number | null | "fehler" {
  if (limit === undefined) return null;
  if (typeof limit !== "string") return "fehler";
  const zahl = Number(limit);
  if (!Number.isInteger(zahl) || zahl < 1) return "fehler";
  return zahl;
}

/** Schneidet eine Seite aus und liefert den Cursor fuer die naechste, falls es eine gibt. */
export function seiteAus<T>(alle: T[], versatz: number, grenze: number | null): { seite: T[]; cursor?: string } {
  const ende = grenze === null ? alle.length : versatz + grenze;
  const seite = alle.slice(versatz, ende);
  return ende < alle.length ? { seite, cursor: cursorAus(ende) } : { seite };
}
