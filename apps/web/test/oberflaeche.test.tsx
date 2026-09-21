import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiReiter, Einstellungen, EinstellungsFormular } from "../src/App.js";
import { AUFRUFE } from "../src/aufrufe.js";

/**
 * Ein statischer Rendervorgang, ohne Browser. Er belegt zweierlei: dass die
 * Bauteile ueberhaupt durchlaufen, und wie der sichtbare Text am Ende lautet.
 * Eine Suche im gebauten Buendel kann das zweite nicht, dort stehen auch
 * Bezeichner und Routennamen.
 */
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const FORMULAR = (
  <EinstellungsFormular
    entwurf={{ upstreamBasis: "https://a.test", proxyBasis: "", aasBasis: "https://b.test", zeitlimitMs: "30000" }}
    setzen={() => undefined}
  />
);

const SICHTBAR = text(
  renderToStaticMarkup(<ApiReiter />) + renderToStaticMarkup(<Einstellungen />) + renderToStaticMarkup(FORMULAR),
);

describe("Rendervorgang", () => {
  it("laeuft ohne Ausnahme durch, auch ohne window und ohne Ablage", () => {
    expect(SICHTBAR.length).toBeGreaterThan(200);
  });

  it("zeigt alle elf Aufrufe", () => {
    for (const aufruf of AUFRUFE) {
      expect(SICHTBAR, aufruf.id).toContain(aufruf.vorlage);
    }
    expect(AUFRUFE).toHaveLength(11);
  });

  it("zeigt jede Gruppe als Ueberschrift", () => {
    for (const gruppe of new Set(AUFRUFE.map((aufruf) => aufruf.gruppe))) {
      expect(SICHTBAR).toContain(gruppe);
    }
  });

  it("zeigt die Einstellungen, solange sie laden", () => {
    expect(SICHTBAR).toContain("Lädt");
  });
});

describe("Sichtbarer Text", () => {
  // Beim Bauen waren alle Umlaute umschrieben. Diese Pruefung sucht die
  // Umschreibungen dort, wo sie stoeren wuerden: im gerenderten Text.
  it("enthaelt keine umschriebenen Umlaute mehr", () => {
    for (const umschrieben of [
      "unveraendert",
      "pruefen",
      "Pruef",
      "Laedt",
      "moeglich",
      "heisst",
      "Oeffentlich",
      "gueltig",
      "oeffnen",
      "Koerper",
      "Hoechst",
      "ausschliesslich",
      "Schraegstrich",
      "uebernimmt",
      "Ueber",
    ]) {
      expect(SICHTBAR, umschrieben).not.toContain(umschrieben);
    }
  });

  it("enthaelt keine Gedankenstriche", () => {
    expect(SICHTBAR).not.toMatch(/[–—]/);
  });

  it("nennt die Felder der Einstellungen mit ihren Bezeichnungen", () => {
    for (const bezeichnung of ["Zielsystem", "Basis der erzeugten AAS-IDs", "Öffentliche Basis", "Zeitlimit"]) {
      expect(SICHTBAR).toContain(bezeichnung);
    }
  });
});
