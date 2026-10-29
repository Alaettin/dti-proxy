import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  aasIdAus,
  ApiReiter,
  erneuerungsStand,
  ItemIds,
  ProxyFormular,
  Uebersicht,
  zeilenAus,
  type ProxyAnsicht,
} from "../src/App.js";
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
  pufferStunden: 24,
  shellsAktiv: true,
  registryAktiv: true,
  submodelRegistryAktiv: true,
  dateiPfadeAbsolut: true,
  erneuertAm: "2026-10-22T08:00:00.000Z",
  naechsteErneuerung: "2026-10-23T08:00:00.000Z",
  erneuerungLaeuft: false,
  angelegtAm: "2026-09-21T00:00:00.000Z",
  basisUrl: "https://dti-proxy.test/p/rc",
  basisPfad: "/p/rc",
  pufferEintraege: 7,
};

const ZWEITER: ProxyAnsicht = {
  ...ERSTER,
  kennung: "kunde-a",
  name: "Kunde A",
  upstreamBasis: "https://kunde-a.test",
  basisUrl: "https://dti-proxy.test/p/kunde-a",
  basisPfad: "/p/kunde-a",
  dateiPfadeAbsolut: false,
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

  it("zeigt alle sechzehn Aufrufe", () => {
    for (const aufruf of AUFRUFE) {
      expect(text(API_ERSTER), aufruf.id).toContain(aufruf.vorlage);
    }
    expect(AUFRUFE).toHaveLength(16);
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

describe("Item-IDs", () => {
  const KARTE = text(renderToStaticMarkup(<ItemIds proxy={ERSTER} neuLaden={async () => undefined} />));

  it("zeigt Karte, Takt der Erneuerung, Bestand und den Knopf", () => {
    expect(KARTE).toContain("Item-IDs für GET /shells und die Registries");
    expect(KARTE).toContain("alle 24 Stunden auf einmal");
    expect(KARTE).not.toContain("ausgeschaltet");
    expect(KARTE).toContain("7 Schalen im Bestand");
    expect(KARTE).toContain("zuletzt erneuert");
    expect(KARTE).toContain("nächste Erneuerung");
    expect(KARTE).toContain("Jetzt erneuern");
    expect(KARTE).not.toContain("Puffer leeren");
  });

  it("sagt, wenn der Puffer aus ist, und sperrt dann den Knopf", () => {
    const markup = renderToStaticMarkup(<ItemIds proxy={{ ...ERSTER, pufferStunden: 0 }} neuLaden={async () => undefined} />);
    expect(text(markup)).toContain("ohne Puffer geht jeder Aufruf nach oben");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Jetzt erneuern/);
    const eine = text(renderToStaticMarkup(<ItemIds proxy={{ ...ERSTER, pufferStunden: 1 }} neuLaden={async () => undefined} />));
    expect(eine).toContain("alle 1 Stunde auf einmal");
  });

  it("sagt, wenn alle drei Wege ausgeschaltet sind", () => {
    const alleAus = text(
      renderToStaticMarkup(
        <ItemIds
          proxy={{ ...ERSTER, shellsAktiv: false, registryAktiv: false, submodelRegistryAktiv: false }}
          neuLaden={async () => undefined}
        />,
      ),
    );
    expect(alleAus).toContain("GET /shells und beide Registries sind für diesen Proxy ausgeschaltet");
    // Einer an genuegt, damit die Liste gebraucht wird.
    const nurSubmodel = text(
      renderToStaticMarkup(
        <ItemIds proxy={{ ...ERSTER, shellsAktiv: false, registryAktiv: false }} neuLaden={async () => undefined} />,
      ),
    );
    expect(nurSubmodel).not.toContain("ausgeschaltet");
  });

  it("beschreibt den Stand der Erneuerung", () => {
    const leer = { pufferEintraege: 0, erneuertAm: null, naechsteErneuerung: null, erneuerungLaeuft: false };
    expect(erneuerungsStand(leer)).toBe("0 Schalen im Bestand, noch nicht erneuert.");
    expect(erneuerungsStand({ ...leer, pufferEintraege: 1, erneuerungLaeuft: true })).toBe(
      "1 Schale im Bestand, Erneuerung läuft.",
    );
    const fertig = erneuerungsStand({
      pufferEintraege: 3,
      erneuertAm: "2026-10-22T08:00:00.000Z",
      naechsteErneuerung: "2026-10-23T08:00:00.000Z",
      erneuerungLaeuft: false,
    });
    expect(fertig).toMatch(/^3 Schalen im Bestand, zuletzt erneuert 22\.10\.26, \d\d:\d\d, nächste Erneuerung 23\.10\.26, \d\d:\d\d\.$/);
  });

  it("liest eine Item-ID je Zeile wie der Server", () => {
    expect(zeilenAus(" B \r\n\nA\nB\n  \nC")).toEqual(["B", "A", "C"]);
    expect(zeilenAus("")).toEqual([]);
  });

  it("baut die AAS-ID wie Discovery", () => {
    expect(aasIdAus("https://viewer.test", "A B/1")).toBe("https://viewer.test/aas?itemId=A%20B%2F1");
  });
});

describe("Proxyformular", () => {
  it("bietet die Pufferdauer an", () => {
    expect(text(FORMULAR)).toContain("Puffer für GET /shells in Stunden");
  });

  it("bietet den Schalter fuer GET /shells an und zeigt seinen Stand", () => {
    expect(text(FORMULAR)).toContain("GET /shells anbieten");
    expect(FORMULAR).not.toMatch(/type="checkbox"[^>]*checked/);
    const an = renderToStaticMarkup(<ProxyFormular werte={{ shellsAktiv: "true" }} setzen={() => undefined} />);
    expect(an).toMatch(/type="checkbox"[^>]*checked/);
  });

  it("bietet einen eigenen Schalter fuer die Submodel Registry an", () => {
    expect(text(FORMULAR)).toContain("Submodel Registry anbieten");
    const nurSubmodel = renderToStaticMarkup(
      <ProxyFormular werte={{ submodelRegistryAktiv: "true" }} setzen={() => undefined} />,
    );
    expect(nurSubmodel.match(/type="checkbox"[^>]*checked/g)).toHaveLength(1);
    expect(nurSubmodel).toMatch(/checked=""[^>]*\/><span>Submodel Registry anbieten/);
  });

  it("bietet einen eigenen Schalter fuer absolute Dateipfade an", () => {
    expect(text(FORMULAR)).toContain("Dateipfade absolut ausgeben");
    const nurPfade = renderToStaticMarkup(
      <ProxyFormular werte={{ dateiPfadeAbsolut: "true" }} setzen={() => undefined} />,
    );
    expect(nurPfade.match(/type="checkbox"[^>]*checked/g)).toHaveLength(1);
    expect(nurPfade).toMatch(/checked=""[^>]*\/><span>Dateipfade absolut ausgeben/);
  });

  it("bietet einen eigenen Schalter fuer die Registry an", () => {
    expect(text(FORMULAR)).toContain("Registry anbieten");
    const nurRegistry = renderToStaticMarkup(<ProxyFormular werte={{ registryAktiv: "true" }} setzen={() => undefined} />);
    // Genau ein Haken: der der Registry, nicht der von GET /shells.
    expect(nurRegistry.match(/type="checkbox"[^>]*checked/g)).toHaveLength(1);
    expect(nurRegistry).toMatch(/checked=""[^>]*\/><span>Registry anbieten/);
  });
});

describe("Reiter API und Schalter", () => {
  it("zeigt GET /shells nur bei eingeschaltetem Proxy", () => {
    const an = text(renderToStaticMarkup(<ApiReiter proxy={ERSTER} />));
    const aus = text(renderToStaticMarkup(<ApiReiter proxy={{ ...ERSTER, shellsAktiv: false }} />));
    // /shells allein, nicht /shells/{aasIdentifier}.
    const nurShells = /\/shells(?![/\w])/;
    expect(an).toMatch(nurShells);
    expect(aus).not.toMatch(nurShells);
    // Die durchgereichten Aufrufe bleiben.
    expect(aus).toContain("/shells/{aasIdentifier}");
  });

  it("zeigt in der Uebersicht, ob GET /shells und die Registries an sind", () => {
    expect(text(UEBERSICHT)).toContain("GET /shells an");
    expect(text(UEBERSICHT)).toContain("· Registry an");
    expect(text(UEBERSICHT)).toContain("Submodel Registry an");
    // Je Proxy: der erste schreibt um, der zweite nicht.
    expect(text(UEBERSICHT)).toContain("Dateipfade absolut");
    expect(text(UEBERSICHT)).toContain("Dateipfade relativ");
  });

  it("zeigt die Submodel Registry nur bei eingeschaltetem Proxy", () => {
    const an = text(renderToStaticMarkup(<ApiReiter proxy={ERSTER} />));
    const aus = text(renderToStaticMarkup(<ApiReiter proxy={{ ...ERSTER, submodelRegistryAktiv: false }} />));
    expect(an).toContain("/submodel-descriptors/{submodelIdentifier}");
    expect(aus).not.toContain("/submodel-descriptors");
    expect(aus).not.toContain("SubmodelRegistry");
  });

  it("zeigt die Registry nur bei eingeschaltetem Proxy", () => {
    const an = text(renderToStaticMarkup(<ApiReiter proxy={ERSTER} />));
    const aus = text(renderToStaticMarkup(<ApiReiter proxy={{ ...ERSTER, registryAktiv: false }} />));
    expect(an).toContain("/shell-descriptors/{aasIdentifier}");
    expect(an).toContain("AssetAdministrationShellRegistry");
    expect(aus).not.toContain("/shell-descriptors");
    expect(aus).not.toContain("AssetAdministrationShellRegistry");
  });
});
