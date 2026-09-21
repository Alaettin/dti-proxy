import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { basisUrl, zustaendigFuer } from "../src/aufloesung.js";
import { datenbankOeffnen, type Datenbank } from "../src/db.js";
import { kennungAus, kennungPruefen, Proxys } from "../src/proxys.js";

let db: Datenbank | undefined;
const verzeichnisse: string[] = [];

afterEach(() => {
  // Aufraeumen im finally-Sinn: ein Rueckstand verfaelscht sonst den naechsten Lauf.
  db?.close();
  db = undefined;
  for (const verzeichnis of verzeichnisse.splice(0)) {
    fs.rmSync(verzeichnis, { recursive: true, force: true });
  }
});

/** Eine echte Datei, damit sich dieselbe Datenbank zweimal oeffnen laesst. */
function dateiPfad(): string {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "dti-proxy-db-"));
  verzeichnisse.push(verzeichnis);
  return path.join(verzeichnis, "test.sqlite");
}

function frisch(): Proxys {
  db = datenbankOeffnen(":memory:");
  return new Proxys(db);
}

function anlegen(proxys: Proxys, kennung: string, ziel = "https://zwei.test"): void {
  const ergebnis = proxys.anlegen({
    kennung,
    name: kennung,
    upstreamBasis: ziel,
    aasBasis: "https://viewer-zwei.test",
    zeitlimitMs: 30_000,
  });
  if ("verstoesse" in ergebnis) throw new Error(JSON.stringify(ergebnis.verstoesse));
}

describe("Frische Datenbank", () => {
  // Kein Proxy hat einen Sonderplatz, also legt der Start auch keinen an.
  // Den ersten legt man in der Uebersicht an.
  it("bleibt leer", () => {
    expect(frisch().alle()).toHaveLength(0);
  });
});

describe("Wanderung vom alten Stand", () => {
  // Der eigentliche Grund: eine bestehende Installation soll nach dem Wechsel
  // auf mehrere Proxys unveraendert weiterlaufen. Geprueft wird die echte
  // Funktion, nicht ein Nachbau davon.
  it("uebernimmt die alten globalen Einstellungen in genau einen Proxy", () => {
    const datei = dateiPfad();
    const alt = new Database(datei);
    alt.exec("CREATE TABLE einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL)");
    const setzen = alt.prepare("INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)");
    setzen.run("upstreamBasis", "https://alt.test");
    setzen.run("aasBasis", "https://viewer-alt.test");
    setzen.run("zeitlimitMs", "12000");
    setzen.run("proxyBasis", "https://oeffentlich.test");
    alt.close();

    db = datenbankOeffnen(datei);
    const alle = new Proxys(db).alle();
    expect(alle).toHaveLength(1);
    expect(alle[0]!.kennung).toBe("standard");
    expect(alle[0]!.upstreamBasis).toBe("https://alt.test");
    expect(alle[0]!.aasBasis).toBe("https://viewer-alt.test");
    expect(alle[0]!.zeitlimitMs).toBe(12_000);

    // Die oeffentliche Basis bleibt global, die drei gewanderten Werte
    // verschwinden aus der alten Tabelle, damit nichts doppelt steht.
    const uebrig = db.prepare("SELECT schluessel FROM einstellungen").all() as { schluessel: string }[];
    expect(uebrig.map((z) => z.schluessel)).toEqual(["proxyBasis"]);
  });

  it("laeuft beim zweiten Oeffnen ohne Wirkung", () => {
    const datei = dateiPfad();
    const erst = datenbankOeffnen(datei);
    anlegen(new Proxys(erst), "eins");
    erst.close();

    db = datenbankOeffnen(datei);
    expect(new Proxys(db).alle()).toHaveLength(1);
  });
});

describe("Wanderung vom Zwischenstand mit Standard", () => {
  // In der Fassung davor trug ein Proxy die Sonderrolle "Standard". Die Spalte
  // muss weg, die Zeilen muessen bleiben.
  it("entfernt die Spalte und behaelt die Proxys", () => {
    const datei = dateiPfad();
    const alt = new Database(datei);
    alt.exec(`
      CREATE TABLE proxys (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kennung TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        upstreamBasis TEXT NOT NULL, aasBasis TEXT NOT NULL, zeitlimitMs INTEGER NOT NULL,
        standard INTEGER NOT NULL DEFAULT 0, angelegtAm TEXT NOT NULL);
      CREATE UNIQUE INDEX proxys_ein_standard ON proxys (standard) WHERE standard = 1;
    `);
    const setzen = alt.prepare(
      "INSERT INTO proxys (kennung, name, upstreamBasis, aasBasis, zeitlimitMs, standard, angelegtAm) VALUES (?,?,?,?,?,?,?)",
    );
    setzen.run("eins", "Eins", "https://eins.test", "https://v1.test", 30000, 1, "2026-09-01T00:00:00.000Z");
    setzen.run("zwei", "Zwei", "https://zwei.test", "https://v2.test", 30000, 0, "2026-09-02T00:00:00.000Z");
    alt.close();

    db = datenbankOeffnen(datei);
    const spalten = (db.prepare("PRAGMA table_info(proxys)").all() as { name: string }[]).map((z) => z.name);
    expect(spalten).not.toContain("standard");

    const alle = new Proxys(db).alle();
    expect(alle.map((p) => p.kennung)).toEqual(["eins", "zwei"]);
    expect(alle[0]!.upstreamBasis).toBe("https://eins.test");
  });
});

describe("kennungAus", () => {
  it("macht aus einem Namen einen brauchbaren Vorschlag", () => {
    expect(kennungAus("Kunde A")).toBe("kunde-a");
    expect(kennungAus("Äpfel & Birnen")).toBe("aepfel-birnen");
    expect(kennungAus("  RC Test  ")).toBe("rc-test");
  });
});

describe("kennungPruefen", () => {
  it("nimmt Kleinbuchstaben, Ziffern und Bindestriche", () => {
    for (const gut of ["a", "rc", "kunde-a", "k1", "a-b-c"]) {
      expect(kennungPruefen(gut), gut).toEqual({ wert: gut });
    }
  });

  it("weist alles andere ab", () => {
    for (const schlecht of ["", "Kunde A", "kunde_a", "-a", "a-", "a".repeat(41), "ä"]) {
      expect(kennungPruefen(schlecht), schlecht).toHaveProperty("text");
    }
  });
});

describe("Proxys verwalten", () => {
  it("legt an, aendert und liest wieder", () => {
    const proxys = frisch();
    anlegen(proxys, "zwei");
    proxys.aendern("zwei", { name: "Zwei neu" });
    expect(proxys.nachKennung("zwei")!.name).toBe("Zwei neu");
    expect(proxys.nachKennung("zwei")!.upstreamBasis).toBe("https://zwei.test");
  });

  it("laesst eine Kennung nicht zweimal zu", () => {
    const proxys = frisch();
    anlegen(proxys, "zwei");
    const nochmal = proxys.anlegen({
      kennung: "zwei",
      name: "Anderer",
      upstreamBasis: "https://x.test",
      aasBasis: "https://y.test",
    });
    expect(nochmal).toHaveProperty("verstoesse");
  });

  it("loescht jeden, auch den letzten", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    expect(proxys.loeschen("eins")).toBeNull();
    expect(proxys.alle()).toHaveLength(0);
  });

  it("meldet einen unbekannten Proxy beim Loeschen", () => {
    expect(frisch().loeschen("gibtsnicht")).toEqual({ fehler: "Diesen Proxy gibt es nicht." });
  });

  it("sortiert nach dem Anlegen", () => {
    const proxys = frisch();
    anlegen(proxys, "erster");
    anlegen(proxys, "zweiter");
    expect(proxys.alle().map((p) => p.kennung)).toEqual(["erster", "zweiter"]);
  });
});

describe("zustaendigFuer", () => {
  // Dieselbe Zusicherung wie in der Weiterleitung: der Rest wird
  // abgeschnitten, nicht zerlegt und neu gebaut.
  it("schneidet den Rest hinter /p/<kennung> zeichengenau ab", () => {
    const proxys = frisch();
    anlegen(proxys, "zwei");
    const rest = "/submodels/aHR0cDovL2E-Yg_c/submodel-elements/A%2FB?level=Deep";
    const treffer = zustaendigFuer("/p/zwei" + rest, proxys);
    expect(treffer?.proxy.kennung).toBe("zwei");
    expect(treffer?.rest).toBe(rest);
    expect(treffer?.basisPfad).toBe("/p/zwei");
  });

  it("erkennt den blanken Proxy-Weg", () => {
    const proxys = frisch();
    anlegen(proxys, "zwei");
    expect(zustaendigFuer("/p/zwei", proxys)?.rest).toBe("");
    expect(zustaendigFuer("/p/zwei/", proxys)?.rest).toBe("/");
  });

  it("ist an der Wurzel fuer niemanden zustaendig", () => {
    const proxys = frisch();
    anlegen(proxys, "zwei");
    for (const pfad of ["/shells/QUJD", "/description", "/", "/lookup/shellsByAssetLink"]) {
      expect(zustaendigFuer(pfad, proxys), pfad).toBeNull();
    }
  });

  it("gibt bei unbekannter Kennung nichts zurueck", () => {
    const proxys = frisch();
    expect(zustaendigFuer("/p/gibtsnicht/description", proxys)).toBeNull();
    expect(zustaendigFuer("/p/", proxys)).toBeNull();
  });
});

describe("basisUrl", () => {
  it("haengt das Praefix jedes Proxys an", () => {
    const proxys = frisch();
    anlegen(proxys, "zwei");
    expect(basisUrl("https://dti.test", proxys.nachKennung("zwei")!)).toBe("https://dti.test/p/zwei");
  });
});
