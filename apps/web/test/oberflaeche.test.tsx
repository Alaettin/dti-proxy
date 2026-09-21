import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiReiter, ProxyFormular, Uebersicht, type ProxyAnsicht } from "../src/App.js";
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

const ERSTER: ProxyAnsicht = {
  kennung: "rc",
  name: "RC",
  upstreamBasis: "https://rc.test",
  aasBasis: "https://viewer.test",
  zeitlimitMs: 30_000,
  angelegtAm: "2026-09-21T00:00:00.000Z",
  basisUrl: "https://dti-proxy.test/p/rc",
  basisPfad: "/p/rc",
};

const ZWEITER: ProxyAnsicht = {
  ...ERSTER,
  kennung: "kunde-a",
  name: "Kunde A",
  upstreamBasis: "https://kunde-a.test",
  basisUrl: "https://dti-proxy.test/p/kunde-a",
  basisPfad: "/p/kunde-a",
};

const UEBERSICHT = renderToStaticMarkup(
  <Uebersicht proxys={[ERSTER, ZWEITER]} gewaehlt="rc" waehlen={() => undefined} neuLaden={async () => undefined} />,
);

const LEERE_UEBERSICHT = renderToStaticMarkup(
  <Uebersicht proxys={[]} gewaehlt="" waehlen={() => undefined} neuLaden={async () => undefined} />,
);

const API_ERSTER = renderToStaticMarkup(<ApiReiter proxy={ERSTER} />);
const API_ZWEITER = renderToStaticMarkup(<ApiReiter proxy={ZWEITER} />);
const FORMULAR = renderToStaticMarkup(<ProxyFormular werte={{}} setzen={() => undefined} />);

const SICHTBAR = text(UEBERSICHT + LEERE_UEBERSICHT + API_ERSTER + FORMULAR);

describe("Rendervorgang", () => {
  it("laeuft ohne Ausnahme durch, auch ohne window und ohne Ablage", () => {
    expect(SICHTBAR.length).toBeGreaterThan(200);
  });

  it("zeigt alle elf Aufrufe", () => {
    for (const aufruf of AUFRUFE) {
      expect(text(API_ERSTER), aufruf.id).toContain(aufruf.vorlage);
    }
    expect(AUFRUFE).toHaveLength(11);
  });

  it("zeigt jede Gruppe als Ueberschrift", () => {
    for (const gruppe of new Set(AUFRUFE.map((aufruf) => aufruf.gruppe))) {
      expect(text(API_ERSTER)).toContain(gruppe);
    }
  });
});

describe("Uebersicht", () => {
  it("zeigt jeden Proxy mit Namen, Ziel und Basis-URL", () => {
    const sichtbar = text(UEBERSICHT);
    for (const proxy of [ERSTER, ZWEITER]) {
      expect(sichtbar, proxy.kennung).toContain(proxy.name);
      expect(sichtbar, proxy.kennung).toContain(proxy.upstreamBasis);
      expect(sichtbar, proxy.kennung).toContain(proxy.basisUrl);
    }
  });

  it("kennzeichnet die Auswahl", () => {
    expect(text(UEBERSICHT)).toContain("Gewählt");
  });

  it("verweist je Proxy auf dessen eigene Swagger-Seite", () => {
    expect(UEBERSICHT).toContain('href="/p/rc/swagger/index.html"');
    expect(UEBERSICHT).toContain('href="/p/kunde-a/swagger/index.html"');
  });

  // Kein Proxy hat einen Sonderplatz mehr.
  it("kennt keinen Standard mehr", () => {
    expect(text(UEBERSICHT)).not.toContain("Als Standard");
    expect(text(UEBERSICHT)).not.toMatch(/\bStandard\b/);
  });

  // Ohne Proxy waere der Bildschirm sonst leer und man faende nicht heraus,
  // was zu tun ist.
  it("laedt ohne Proxy zum Anlegen ein", () => {
    const sichtbar = text(LEERE_UEBERSICHT);
    expect(sichtbar).toContain("Noch kein Proxy angelegt");
    expect(sichtbar).toContain("Anlegen");
    // Kein Abbrechen, es gibt nichts, wohin man abbrechen koennte.
    expect(sichtbar).not.toContain("Abbrechen");
  });
});

describe("API-Reiter je Proxy", () => {
  // Der eigentliche Punkt bei mehreren Proxys: die Adressen muessen sich
  // unterscheiden, sonst fragt man immer dasselbe Ziel.
  it("traegt das Praefix des gewaehlten Proxys in jeder Adresse", () => {
    expect(text(API_ERSTER)).toContain("/p/rc/shells/{aasIdentifier}");
    expect(text(API_ZWEITER)).toContain("/p/kunde-a/shells/{aasIdentifier}");
    // Keine Adresse ohne Praefix, sonst zeigte sie auf die Wurzel und damit
    // auf niemanden.
    expect(text(API_ZWEITER)).not.toMatch(/(?<!\/p\/kunde-a)\/shells\/\{aasIdentifier\}/);
    expect(text(API_ERSTER)).not.toMatch(/(?<!\/p\/rc)\/shells\/\{aasIdentifier\}/);
  });

  it("nennt die Basis-URL des Proxys im Hinweis", () => {
    expect(text(API_ZWEITER)).toContain("https://dti-proxy.test/p/kunde-a");
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
      "waehlt",
      "Loeschen",
    ]) {
      expect(SICHTBAR, umschrieben).not.toContain(umschrieben);
    }
  });

  it("enthaelt keine Gedankenstriche", () => {
    expect(SICHTBAR).not.toMatch(/[–—]/);
  });

  it("nennt die Felder eines Proxys mit ihren Bezeichnungen", () => {
    for (const bezeichnung of ["Name", "Kennung", "Zielsystem", "Basis der erzeugten AAS-IDs", "Zeitlimit"]) {
      expect(text(FORMULAR)).toContain(bezeichnung);
    }
  });
});
