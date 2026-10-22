import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { konfiguration } from "./konfiguration.js";

export type Datenbank = Database.Database;

/** Vorgaben fuer den Proxy, der aus einem alten Stand hervorgeht. */
export const PROXY_VORGABEN = {
  upstreamBasis: "https://rc.test.dti.neoception.dev",
  aasBasis: "https://viewer-rc.test.dti.neoception.dev",
  zeitlimitMs: 30_000,
  pufferStunden: 24,
  shellsAktiv: false,
  registryAktiv: false,
  submodelRegistryAktiv: false,
} as const;

function spalten(db: Datenbank, tabelle: string): string[] {
  const zeilen = db.prepare(`PRAGMA table_info(${tabelle})`).all() as { name: string }[];
  return zeilen.map((zeile) => zeile.name);
}

/**
 * Wanderung vom Zwischenstand, in dem ein Proxy als Standard ausgezeichnet war
 * und zusaetzlich an der Wurzel lag. Die Sonderrolle ist weggefallen, alle
 * Proxys sind gleich. Die Zeilen bleiben, nur die Spalte geht.
 */
function standardAbbauen(db: Datenbank): void {
  if (!spalten(db, "proxys").includes("standard")) return;
  db.exec("DROP INDEX IF EXISTS proxys_ein_standard");
  db.exec("ALTER TABLE proxys DROP COLUMN standard");
}

/**
 * Wanderung vom ersten Stand, in dem der Dienst genau ein Zielsystem trug und
 * die Werte global in `einstellungen` standen. Eine bestehende Installation
 * soll nach dem Wechsel auf mehrere Proxys unveraendert weiterlaufen.
 *
 * Eine wirklich frische Datenbank bleibt leer: dort legt man den ersten Proxy
 * in der Uebersicht an.
 */
function altenStandUebernehmen(db: Datenbank): void {
  const vorhanden = db.prepare("SELECT COUNT(*) AS zahl FROM proxys").get() as { zahl: number };
  if (vorhanden.zahl > 0) return;

  const alt = new Map(
    (db.prepare("SELECT schluessel, wert FROM einstellungen").all() as { schluessel: string; wert: string }[]).map(
      (zeile) => [zeile.schluessel, zeile.wert],
    ),
  );
  if (!alt.has("upstreamBasis") && !alt.has("aasBasis") && !alt.has("zeitlimitMs")) return;

  const zeitlimit = Number(alt.get("zeitlimitMs"));
  db.prepare(
    `INSERT INTO proxys (kennung, name, upstreamBasis, aasBasis, zeitlimitMs, angelegtAm)
     VALUES (?, ?, ?, ?, ?, ?)`,
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

/**
 * Wanderung vom Stand ohne GET /shells. Bestehende Proxys bekommen die
 * Vorgaben, der Endpunkt ist bei ihnen also aus, bis ihn jemand einschaltet.
 */
function shellsSpaltenErgaenzen(db: Datenbank): void {
  const vorhanden = spalten(db, "proxys");
  if (!vorhanden.includes("pufferStunden")) {
    db.exec(`ALTER TABLE proxys ADD COLUMN pufferStunden INTEGER NOT NULL DEFAULT ${PROXY_VORGABEN.pufferStunden}`);
  }
  if (!vorhanden.includes("shellsAktiv")) {
    db.exec(`ALTER TABLE proxys ADD COLUMN shellsAktiv INTEGER NOT NULL DEFAULT ${PROXY_VORGABEN.shellsAktiv ? 1 : 0}`);
  }
  if (!vorhanden.includes("registryAktiv")) {
    db.exec(
      `ALTER TABLE proxys ADD COLUMN registryAktiv INTEGER NOT NULL DEFAULT ${PROXY_VORGABEN.registryAktiv ? 1 : 0}`,
    );
  }
  if (!vorhanden.includes("submodelRegistryAktiv")) {
    db.exec(
      `ALTER TABLE proxys ADD COLUMN submodelRegistryAktiv INTEGER NOT NULL DEFAULT ${
        PROXY_VORGABEN.submodelRegistryAktiv ? 1 : 0
      }`,
    );
  }
}

export function datenbankOeffnen(datei: string = konfiguration.datenbankDatei): Datenbank {
  if (datei !== ":memory:") {
    fs.mkdirSync(path.dirname(datei), { recursive: true });
  }
  const db = new Database(datei);
  db.pragma("journal_mode = WAL");
  // better-sqlite3 hat das ab Werk an. Ausdruecklich, weil sonst ON DELETE
  // CASCADE die Item-IDs eines geloeschten Proxys still liegen liesse.
  db.pragma("foreign_keys = ON");
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
      angelegtAm    TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      proxyId  INTEGER NOT NULL REFERENCES proxys(id) ON DELETE CASCADE,
      itemId   TEXT    NOT NULL,
      position INTEGER NOT NULL,
      UNIQUE (proxyId, itemId)
    );
  `);
  standardAbbauen(db);
  shellsSpaltenErgaenzen(db);
  altenStandUebernehmen(db);
  return db;
}
