import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { basisUrl, zustaendigFuer } from "../src/aufloesung.js";
import { datenbankOeffnen, type Datenbank } from "../src/db.js";
import { ITEM_LAENGE_MAX, ITEMS_MAX, kennungAus, kennungPruefen, Proxys } from "../src/proxys.js";

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

describe("Wanderung auf Puffer und Item-IDs", () => {
  // Der Stand vor GET /shells: proxys ohne pufferStunden und shellsAktiv, keine Tabelle items.
  it("ergaenzt die Spalten mit den Vorgaben und legt die Tabelle an", () => {
    const datei = dateiPfad();
    const alt = new Database(datei);
    alt.exec(`
      CREATE TABLE einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL);
      CREATE TABLE proxys (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kennung TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        upstreamBasis TEXT NOT NULL, aasBasis TEXT NOT NULL, zeitlimitMs INTEGER NOT NULL,
        angelegtAm TEXT NOT NULL);
    `);
    alt
      .prepare(
        "INSERT INTO proxys (kennung, name, upstreamBasis, aasBasis, zeitlimitMs, angelegtAm) VALUES (?,?,?,?,?,?)",
      )
      .run("pf", "P+F", "https://pf.test", "https://viewer-pf.test", 30000, "2026-09-24T00:00:00.000Z");
    alt.close();

    db = datenbankOeffnen(datei);
    const proxys = new Proxys(db);
    expect(proxys.nachKennung("pf")!.pufferStunden).toBe(24);
    // Ein bestehender Proxy bietet GET /shells erst an, wenn ihn jemand einschaltet.
    expect(proxys.nachKennung("pf")!.shellsAktiv).toBe(false);
    expect(proxys.nachKennung("pf")!.registryAktiv).toBe(false);
    expect(proxys.nachKennung("pf")!.submodelRegistryAktiv).toBe(false);
    expect(proxys.itemIdsSetzen("pf", ["A"])).toEqual({ itemIds: ["A"] });
    db.close();

    // Zweites Oeffnen: nichts doppelt, nichts verloren.
    db = datenbankOeffnen(datei);
    expect(new Proxys(db).itemIds("pf")).toEqual(["A"]);
  });
});

describe("Pufferdauer", () => {
  it("hat die Vorgabe 24 Stunden und nimmt 0 bis 720", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    expect(proxys.nachKennung("eins")!.pufferStunden).toBe(24);
    for (const gut of [0, 1, 720, "48"]) {
      const ergebnis = proxys.aendern("eins", { pufferStunden: gut });
      expect(ergebnis, String(gut)).toHaveProperty("proxy");
    }
    expect(proxys.nachKennung("eins")!.pufferStunden).toBe(48);
  });

  it("weist alles andere ab", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    for (const schlecht of [-1, 721, 1.5, "", "x"]) {
      const ergebnis = proxys.aendern("eins", { pufferStunden: schlecht });
      expect(ergebnis, String(schlecht)).toHaveProperty("verstoesse");
    }
    expect(proxys.nachKennung("eins")!.pufferStunden).toBe(24);
  });
});

describe("Schalter fuer GET /shells", () => {
  it("ist ab Werk aus und laesst sich ein- und ausschalten", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    expect(proxys.nachKennung("eins")!.shellsAktiv).toBe(false);
    proxys.aendern("eins", { shellsAktiv: true });
    expect(proxys.nachKennung("eins")!.shellsAktiv).toBe(true);
    expect(proxys.alle()[0]!.shellsAktiv).toBe(true);
    proxys.aendern("eins", { shellsAktiv: "false" });
    expect(proxys.nachKennung("eins")!.shellsAktiv).toBe(false);
    proxys.aendern("eins", { shellsAktiv: "true" });
    expect(proxys.nachKennung("eins")!.shellsAktiv).toBe(true);
  });

  it("bleibt stehen, wenn ein anderes Feld geaendert wird", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    proxys.aendern("eins", { shellsAktiv: true });
    proxys.aendern("eins", { name: "Anders" });
    expect(proxys.nachKennung("eins")!.shellsAktiv).toBe(true);
  });

  it("weist andere Werte ab", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    for (const schlecht of ["ja", "1", ""]) {
      expect(proxys.aendern("eins", { shellsAktiv: schlecht }), schlecht).toHaveProperty("verstoesse");
    }
  });
});

describe("Schalter fuer die Registry", () => {
  it("ist ab Werk aus und unabhaengig von GET /shells", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    expect(proxys.nachKennung("eins")!.registryAktiv).toBe(false);
    proxys.aendern("eins", { registryAktiv: "true" });
    expect(proxys.nachKennung("eins")).toMatchObject({ registryAktiv: true, shellsAktiv: false });
    proxys.aendern("eins", { shellsAktiv: true, registryAktiv: false });
    expect(proxys.nachKennung("eins")).toMatchObject({ registryAktiv: false, shellsAktiv: true });
    expect(proxys.alle()[0]!.registryAktiv).toBe(false);
  });

  it("hat fuer die Submodel Registry einen eigenen, dritten Schalter", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    expect(proxys.nachKennung("eins")!.submodelRegistryAktiv).toBe(false);
    proxys.aendern("eins", { submodelRegistryAktiv: "true" });
    expect(proxys.nachKennung("eins")).toMatchObject({
      submodelRegistryAktiv: true,
      registryAktiv: false,
      shellsAktiv: false,
    });
    expect(proxys.alle()[0]!.submodelRegistryAktiv).toBe(true);
    const falsch = proxys.aendern("eins", { submodelRegistryAktiv: "ja" });
    expect(falsch).toMatchObject({ verstoesse: [{ feld: "submodelRegistryAktiv" }] });
    expect(JSON.stringify(falsch)).toContain("Submodel Registry");
  });

  it("weist andere Werte ab und nennt die Registry", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    const ergebnis = proxys.aendern("eins", { registryAktiv: "ja" });
    expect(ergebnis).toMatchObject({ verstoesse: [{ feld: "registryAktiv" }] });
    expect(JSON.stringify(ergebnis)).toContain("Registry");
  });
});

describe("Item-IDs", () => {
  it("trimmt, verwirft Leere und Doppelte, die erste Stelle gilt", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    expect(proxys.itemIdsSetzen("eins", [" B ", "", "A", "B", "  ", "C"])).toEqual({ itemIds: ["B", "A", "C"] });
    expect(proxys.itemIds("eins")).toEqual(["B", "A", "C"]);
  });

  it("ersetzt die ganze Liste", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    proxys.itemIdsSetzen("eins", ["A", "B"]);
    proxys.itemIdsSetzen("eins", ["C"]);
    expect(proxys.itemIds("eins")).toEqual(["C"]);
  });

  it("haelt die Listen der Proxys auseinander", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    anlegen(proxys, "zwei");
    proxys.itemIdsSetzen("eins", ["A"]);
    proxys.itemIdsSetzen("zwei", ["B"]);
    expect(proxys.itemIds("eins")).toEqual(["A"]);
    expect(proxys.itemIds("zwei")).toEqual(["B"]);
  });

  it("weist falsche Eingaben und Ueberlaenge ab und laesst die Liste stehen", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    proxys.itemIdsSetzen("eins", ["A"]);
    for (const schlecht of [undefined, "A", [1], ["x".repeat(ITEM_LAENGE_MAX + 1)]]) {
      expect(proxys.itemIdsSetzen("eins", schlecht), JSON.stringify(schlecht)?.slice(0, 20)).toHaveProperty("fehler");
    }
    const zuViele = Array.from({ length: ITEMS_MAX + 1 }, (_, nummer) => String(nummer));
    expect(proxys.itemIdsSetzen("eins", zuViele)).toHaveProperty("fehler");
    expect(proxys.itemIds("eins")).toEqual(["A"]);
  });

  it("behaelt die Liste, wenn sich die Kennung aendert", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    proxys.itemIdsSetzen("eins", ["A"]);
    proxys.aendern("eins", { kennung: "neu" });
    expect(proxys.itemIds("neu")).toEqual(["A"]);
  });

  it("nimmt die Liste beim Loeschen mit", () => {
    const proxys = frisch();
    anlegen(proxys, "eins");
    proxys.itemIdsSetzen("eins", ["A"]);
    proxys.loeschen("eins");
    const uebrig = db!.prepare("SELECT COUNT(*) AS zahl FROM items").get() as { zahl: number };
    expect(uebrig.zahl).toBe(0);
  });

  it("kennt einen unbekannten Proxy nicht", () => {
    const proxys = frisch();
    expect(proxys.itemIds("gibtsnicht")).toBeNull();
    expect(proxys.itemIdsSetzen("gibtsnicht", ["A"])).toBeNull();
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
