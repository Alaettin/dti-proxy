import crypto from "node:crypto";
import path from "node:path";

const produktion = process.env.NODE_ENV === "production";

// DATA_DIR muss ausdruecklich in den Pfad der Datenbank einfliessen. Ein Volume,
// das nur gemountet ist, waehrend die App relativ aufloest, laeuft ins Leere.
const datenVerzeichnis = process.env.DATA_DIR ?? path.resolve(process.cwd(), "daten");

function sitzungsGeheimnis(): string {
  const gesetzt = process.env.SESSION_SECRET;
  if (gesetzt && gesetzt.length >= 16) return gesetzt;
  if (produktion) {
    throw new Error("SESSION_SECRET fehlt oder ist kuerzer als 16 Zeichen. Im Betrieb ist das Pflicht.");
  }
  return crypto.randomBytes(32).toString("hex");
}

export const konfiguration = {
  produktion,
  port: Number(process.env.PORT ?? 3000),
  datenVerzeichnis,
  datenbankDatei: process.env.DB_DATEI ?? path.join(datenVerzeichnis, "dti-proxy.sqlite"),
  adminBenutzer: process.env.ADMIN_USER ?? "NeoAdmin",
  adminPasswort: process.env.ADMIN_PASSWORT ?? "Password!2026",
  sitzungsGeheimnis: sitzungsGeheimnis(),
  webVerzeichnis: process.env.WEB_DIR ?? path.resolve(process.cwd(), "../web/dist"),
} as const;
