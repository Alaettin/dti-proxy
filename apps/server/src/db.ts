import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { konfiguration } from "./konfiguration.js";

export type Datenbank = Database.Database;

/** Vorgaben fuer den ersten Proxy, wenn noch keiner da ist. */
export const PROXY_VORGABEN = {
  upstreamBasis: "https://rc.test.dti.neoception.dev",
  aasBasis: "https://viewer-rc.test.dti.neoception.dev",
  zeitlimitMs: 30_000,
} as const;

/**
 * Legt den ersten Proxy an, wenn noch keiner da ist. Aus den alten globalen
 * Einstellungen, falls dort welche stehen: eine bestehende Installation soll
 * nach dem Wechsel auf mehrere Proxys unveraendert weiterlaufen.
 *
 * Idempotent, laeuft bei jedem Start.
 */
function ersteinrichtung(db: Datenbank): void {
  const vorhanden = db.prepare("SELECT COUNT(*) AS zahl FROM proxys").get() as { zahl: number };
  if (vorhanden.zahl > 0) return;

  const alt = new Map(
    (db.prepare("SELECT schluessel, wert FROM einstellungen").all() as { schluessel: string; wert: string }[]).map(
      (zeile) => [zeile.schluessel, zeile.wert],
    ),
  );
  const zeitlimit = Number(alt.get("zeitlimitMs"));

  db.prepare(
    `INSERT INTO proxys (kennung, name, upstreamBasis, aasBasis, zeitlimitMs, standard, angelegtAm)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    "standard",
    "Standard",
    alt.get("upstreamBasis") ?? PROXY_VORGABEN.upstreamBasis,
    alt.get("aasBasis") ?? PROXY_VORGABEN.aasBasis,
    Number.isInteger(zeitlimit) && zeitlimit > 0 ? zeitlimit : PROXY_VORGABEN.zeitlimitMs,
    new Date().toISOString(),
  );

  // Die Werte leben jetzt in der Zeile. Stehen sie doppelt, faengt man sich
  // spaeter die Frage ein, welche Seite gilt.
  db.prepare("DELETE FROM einstellungen WHERE schluessel IN ('upstreamBasis','aasBasis','zeitlimitMs')").run();
}

export function datenbankOeffnen(datei: string = konfiguration.datenbankDatei): Datenbank {
  if (datei !== ":memory:") {
    fs.mkdirSync(path.dirname(datei), { recursive: true });
  }
  const db = new Database(datei);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS einstellungen (
      schluessel TEXT PRIMARY KEY,
      wert       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS proxys (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      kennung       TEXT    NOT NULL UNIQUE,
      name          TEXT    NOT NULL,
      upstreamBasis TEXT    NOT NULL,
      aasBasis      TEXT    NOT NULL,
      zeitlimitMs   INTEGER NOT NULL,
      standard      INTEGER NOT NULL DEFAULT 0,
      angelegtAm    TEXT    NOT NULL
    );

    -- Genau ein Standard, und zwar von der Datenbank erzwungen. Eine Regel, die
    -- nur im Code steht, haelt genau so lange wie der naechste neue Schreibweg.
    CREATE UNIQUE INDEX IF NOT EXISTS proxys_ein_standard
      ON proxys (standard) WHERE standard = 1;
  `);
  ersteinrichtung(db);
  return db;
}
