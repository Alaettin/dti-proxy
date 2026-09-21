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

function zweiter(proxys: Proxys, kennung = "zwei"): void {
  const ergebnis = proxys.anlegen({
    kennung,
    name: kennung,
    upstreamBasis: "https://zwei.test",
    aasBasis: "https://viewer-zwei.test",
    zeitlimitMs: 30_000,
  });
  if ("verstoesse" in ergebnis) throw new Error(JSON.stringify(ergebnis.verstoesse));
}

describe("Ersteinrichtung", () => {
  it("legt genau einen Standardproxy an", () => {
    const proxys = frisch();
    const alle = proxys.alle();
    expect(alle).toHaveLength(1);
    expect(alle[0]!.kennung).toBe("standard");
    expect(alle[0]!.standard).toBe(true);
    expect(alle[0]!.upstreamBasis).toBe("https://rc.test.dti.neoception.dev");
  });

  it("laeuft beim zweiten Oeffnen ohne Wirkung", () => {
    const datei = dateiPfad();
    const erst = datenbankOeffnen(datei);
    new Proxys(erst).anlegen({
      kennung: "zwei",
      name: "Zwei",
      upstreamBasis: "https://zwei.test",
      aasBasis: "https://v.test",
    });
    erst.close();

    db = datenbankOeffnen(datei);
    const proxys = new Proxys(db);
    expect(proxys.anzahl()).toBe(2);
    expect(proxys.standard()!.kennung).toBe("standard");
  });

  // Der eigentliche Grund fuer die Wanderung: eine bestehende Installation
  // soll nach dem Wechsel auf mehrere Proxys unveraendert weiterlaufen.
  // Geprueft wird die echte Funktion, nicht ein Nachbau davon.
  it("uebernimmt die alten globalen Einstellungen", () => {
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
    const standard = new Proxys(db).standard();
    expect(standard?.upstreamBasis).toBe("https://alt.test");
    expect(standard?.aasBasis).toBe("https://viewer-alt.test");
    expect(standard?.zeitlimitMs).toBe(12_000);

    // Die oeffentliche Basis bleibt global und wird nicht mitgenommen, die
    // drei gewanderten Werte verschwinden aus der alten Tabelle.
    const uebrig = db.prepare("SELECT schluessel FROM einstellungen").all() as { schluessel: string }[];
    expect(uebrig.map((z) => z.schluessel)).toEqual(["proxyBasis"]);
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
    zweiter(proxys);
    expect(proxys.anzahl()).toBe(2);
    proxys.aendern("zwei", { name: "Zwei neu" });
    expect(proxys.nachKennung("zwei")!.name).toBe("Zwei neu");
    expect(proxys.nachKennung("zwei")!.upstreamBasis).toBe("https://zwei.test");
  });

  it("laesst eine Kennung nicht zweimal zu", () => {
    const proxys = frisch();
    zweiter(proxys);
    const nochmal = proxys.anlegen({
      kennung: "zwei",
      name: "Anderer",
      upstreamBasis: "https://x.test",
      aasBasis: "https://y.test",
    });
    expect(nochmal).toHaveProperty("verstoesse");
  });

  it("haelt genau einen Standard, von der Datenbank erzwungen", () => {
    const proxys = frisch();
    zweiter(proxys);
    proxys.standardSetzen("zwei");
    expect(proxys.standard()!.kennung).toBe("zwei");
    expect(proxys.alle().filter((p) => p.standard)).toHaveLength(1);

    // Gegenprobe: an der Klasse vorbei zwei Standards zu setzen, muss scheitern.
    expect(() => db!.prepare("UPDATE proxys SET standard = 1").run()).toThrow();
  });

  it("laesst den letzten Proxy stehen", () => {
    const proxys = frisch();
    expect(proxys.loeschen("standard")).toEqual({ fehler: "Der letzte Proxy lässt sich nicht löschen." });
    expect(proxys.anzahl()).toBe(1);
  });

  it("laesst beim Loeschen des Standards einen nachruecken", () => {
    const proxys = frisch();
    zweiter(proxys);
    expect(proxys.loeschen("standard")).toBeNull();
    expect(proxys.anzahl()).toBe(1);
    expect(proxys.standard()!.kennung).toBe("zwei");
  });
});

describe("zustaendigFuer", () => {
  it("nimmt an der Wurzel den Standard", () => {
    const proxys = frisch();
    const treffer = zustaendigFuer("/shells/QUJD", proxys);
    expect(treffer?.proxy.kennung).toBe("standard");
    expect(treffer?.rest).toBe("/shells/QUJD");
    expect(treffer?.basisPfad).toBe("");
  });

  // Dieselbe Zusicherung wie in der Weiterleitung: der Rest wird
  // abgeschnitten, nicht zerlegt und neu gebaut.
  it("schneidet den Rest hinter /p/<kennung> zeichengenau ab", () => {
    const proxys = frisch();
    zweiter(proxys);
    const rest = "/submodels/aHR0cDovL2E-Yg_c/submodel-elements/A%2FB?level=Deep";
    const treffer = zustaendigFuer("/p/zwei" + rest, proxys);
    expect(treffer?.proxy.kennung).toBe("zwei");
    expect(treffer?.rest).toBe(rest);
    expect(treffer?.basisPfad).toBe("/p/zwei");
  });

  it("erkennt den blanken Proxy-Weg", () => {
    const proxys = frisch();
    zweiter(proxys);
    expect(zustaendigFuer("/p/zwei", proxys)?.rest).toBe("");
    expect(zustaendigFuer("/p/zwei/", proxys)?.rest).toBe("/");
  });

  it("gibt bei unbekannter Kennung nichts zurueck", () => {
    const proxys = frisch();
    expect(zustaendigFuer("/p/gibtsnicht/description", proxys)).toBeNull();
    expect(zustaendigFuer("/p/", proxys)).toBeNull();
  });
});

describe("basisUrl", () => {
  it("laesst den Standard an der Wurzel und haengt sonst das Praefix an", () => {
    const proxys = frisch();
    zweiter(proxys);
    expect(basisUrl("https://dti.test", proxys.nachKennung("standard")!)).toBe("https://dti.test");
    expect(basisUrl("https://dti.test", proxys.nachKennung("zwei")!)).toBe("https://dti.test/p/zwei");
  });
});
