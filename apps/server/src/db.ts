import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { konfiguration } from "./konfiguration.js";

export type Datenbank = Database.Database;

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
  `);
  return db;
}
