import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AUFRUFE, aufrufeFuer, curlBauen, urlBauen, type Aufruf, type Parameter } from "./aufrufe.js";

export interface ProxyAnsicht {
  kennung: string;
  name: string;
  upstreamBasis: string;
  aasBasis: string;
  zeitlimitMs: number;
  pufferStunden: number;
  shellsAktiv: boolean;
  registryAktiv: boolean;
  submodelRegistryAktiv: boolean;
  dateiPfadeAbsolut: boolean;
  /** Zeitpunkte als ISO-Text, null solange es keinen gibt. */
  erneuertAm: string | null;
  naechsteErneuerung: string | null;
  erneuerungLaeuft: boolean;
  angelegtAm: string;
  basisUrl: string;
  basisPfad: string;
  /** Zahl der Schalen, die GET /shells gerade im Puffer hat. */
  pufferEintraege: number;
}

/**
 * Derselbe Vorschlag wie auf dem Server, damit man die entstehende Adresse
 * schon beim Tippen sieht. Der Server entscheidet trotzdem selbst.
 */
export function kennungAus(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

interface Meldung {
  art: "gut" | "schlecht";
  text: string;
}

interface Verstoss {
  feld: string;
  text: string;
}

async function hole(pfad: string, optionen: RequestInit = {}): Promise<Response> {
  return fetch(pfad, {
    credentials: "same-origin",
    headers: optionen.body === undefined ? undefined : { "content-type": "application/json" },
    ...optionen,
  });
}

function verstossText(inhalt: { fehler?: string; verstoesse?: Verstoss[] }): string {
  return inhalt.verstoesse?.map((v) => v.text).join(" ") ?? inhalt.fehler ?? "Unbekannter Fehler.";
}

function Meldungsfeld({ meldung }: { meldung: Meldung | null }): React.ReactElement | null {
  if (meldung === null) return null;
  return <div className={`meldung ${meldung.art}`}>{meldung.text}</div>;
}

function Anmeldung({ fertig }: { fertig: () => void }): React.ReactElement {
  const [benutzer, setzeBenutzer] = useState("");
  const [passwort, setzePasswort] = useState("");
  const [meldung, setzeMeldung] = useState<Meldung | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);

  async function absenden(ereignis: FormEvent): Promise<void> {
    ereignis.preventDefault();
    setzeLaeuft(true);
    setzeMeldung(null);
    try {
      const antwort = await hole("/admin/api/anmelden", {
        method: "POST",
        body: JSON.stringify({ benutzer, passwort }),
      });
      if (antwort.ok) {
        fertig();
        return;
      }
      const inhalt = (await antwort.json()) as { fehler?: string };
      setzeMeldung({ art: "schlecht", text: inhalt.fehler ?? "Die Anmeldung ist fehlgeschlagen." });
    } catch (fehler) {
      setzeMeldung({ art: "schlecht", text: `Der Server antwortet nicht: ${String(fehler)}` });
    } finally {
      setzeLaeuft(false);
    }
  }

  return (
    <div className="rahmen anmeldung">
      <div className="karte">
        <h2>DTI Proxy</h2>
        <p className="hinweis">Bitte anmelden.</p>
        <form onSubmit={absenden}>
          <label>
            <span>Benutzer</span>
            <input value={benutzer} onChange={(e) => setzeBenutzer(e.target.value)} autoComplete="username" autoFocus />
          </label>
          <label>
            <span>Passwort</span>
            <input
              type="password"
              value={passwort}
              onChange={(e) => setzePasswort(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button className="tat" type="submit" disabled={laeuft}>
            {laeuft ? "Prüft …" : "Anmelden"}
          </button>
          <Meldungsfeld meldung={meldung} />
        </form>
      </div>
    </div>
  );
}

function Kopieren({ wert, was }: { wert: string; was: string }): React.ReactElement {
  const [gemeldet, setzeGemeldet] = useState<string | null>(null);
  return (
    <>
      <button
        className="tat still"
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(wert)
            .then(() => setzeGemeldet(`${was} kopiert.`))
            .catch(() => setzeGemeldet("Das Kopieren war nicht möglich."));
        }}
      >
        Kopieren
      </button>
      {gemeldet !== null && <span className="hinweis">{gemeldet}</span>}
    </>
  );
}

export const PROXY_FELDER: {
  name: "name" | "kennung" | "upstreamBasis" | "aasBasis" | "zeitlimitMs" | "pufferStunden";
  titel: string;
  hinweis: string;
}[] = [
  { name: "name", titel: "Name", hinweis: "Nur zur Anzeige." },
  { name: "kennung", titel: "Kennung", hinweis: "Steht in der Adresse unter /p/. Kleinbuchstaben, Ziffern, Bindestriche." },
  { name: "upstreamBasis", titel: "Zielsystem", hinweis: "Dorthin gehen die zehn AAS-Aufrufe unverändert." },
  { name: "aasBasis", titel: "Basis der erzeugten AAS-IDs", hinweis: "Schema und Domain für /aas?itemId=…" },
  { name: "zeitlimitMs", titel: "Zeitlimit in Millisekunden", hinweis: "Zwischen 1000 und 300000." },
  {
    name: "pufferStunden",
    titel: "Puffer für GET /shells in Stunden",
    hinweis: "So lange bleibt eine Schale von oben gespeichert. 0 schaltet den Puffer ab, höchstens 720.",
  },
];

export function ProxyFormular({
  werte,
  setzen,
  ohneKennung = false,
}: {
  werte: Record<string, string>;
  setzen: (neu: Record<string, string>) => void;
  ohneKennung?: boolean;
}): React.ReactElement {
  return (
    <>
      {PROXY_FELDER.filter((feld) => !(ohneKennung && feld.name === "kennung")).map(({ name, titel, hinweis }) => (
        <label key={name}>
          <span>
            {titel} <em>{hinweis}</em>
          </span>
          <input
            value={werte[name] ?? ""}
            onChange={(e) => setzen({ ...werte, [name]: e.target.value })}
            spellCheck={false}
          />
        </label>
      ))}
      <label className="schalter">
        <input
          type="checkbox"
          checked={werte.shellsAktiv === "true"}
          onChange={(e) => setzen({ ...werte, shellsAktiv: e.target.checked ? "true" : "false" })}
        />
        <span>GET /shells anbieten</span>
      </label>
      <label className="schalter">
        <input
          type="checkbox"
          checked={werte.registryAktiv === "true"}
          onChange={(e) => setzen({ ...werte, registryAktiv: e.target.checked ? "true" : "false" })}
        />
        <span>Registry anbieten (GET /shell-descriptors)</span>
      </label>
      <label className="schalter">
        <input
          type="checkbox"
          checked={werte.submodelRegistryAktiv === "true"}
          onChange={(e) => setzen({ ...werte, submodelRegistryAktiv: e.target.checked ? "true" : "false" })}
        />
        <span>Submodel Registry anbieten (GET /submodel-descriptors)</span>
      </label>
      <p className="hinweis">
        Ausgeschaltet antworten die Wege mit 404 und fehlen auf der Swagger-Seite. Die Item-IDs bleiben gespeichert.
      </p>
      <label className="schalter">
        <input
          type="checkbox"
          checked={werte.dateiPfadeAbsolut === "true"}
          onChange={(e) => setzen({ ...werte, dateiPfadeAbsolut: e.target.checked ? "true" : "false" })}
        />
        <span>Dateipfade absolut ausgeben</span>
      </label>
      <p className="hinweis">
        Das Zielsystem meldet bei File-Elementen nur relative Pfade wie /aasx/suppl/logo.png. Eingeschaltet zeigen
        sie auf den Abruf der Datei über diesen Proxy (…/attachment), das Vorschaubild der Schale auf
        …/asset-information/thumbnail. Ausgeschaltet geht jede Antwort unverändert durch.
      </p>
    </>
  );
}

const LEERER_PROXY: Record<string, string> = {
  name: "",
  kennung: "",
  upstreamBasis: "https://rc.test.dti.neoception.dev",
  aasBasis: "https://viewer-rc.test.dti.neoception.dev",
  zeitlimitMs: "30000",
  pufferStunden: "24",
  shellsAktiv: "false",
  registryAktiv: "false",
  submodelRegistryAktiv: "false",
  dateiPfadeAbsolut: "false",
};

export function Uebersicht({
  proxys,
  gewaehlt,
  waehlen,
  neuLaden,
}: {
  proxys: ProxyAnsicht[];
  gewaehlt: string;
  waehlen: (kennung: string) => void;
  neuLaden: () => Promise<void>;
}): React.ReactElement {
  const [neu, setzeNeu] = useState<Record<string, string>>(LEERER_PROXY);
  // Ohne Proxy ist das Formular der einzige sinnvolle Inhalt, also offen.
  const [formularOffen, setzeFormularOffen] = useState(proxys.length === 0);
  const [kennungVonHand, setzeKennungVonHand] = useState(false);
  const [meldung, setzeMeldung] = useState<Meldung | null>(null);
  const [pruefungen, setzePruefungen] = useState<Record<string, string>>({});
  const [laeuft, setzeLaeuft] = useState(false);

  /** Solange niemand die Kennung angefasst hat, folgt sie dem Namen. */
  function neuSetzen(werte: Record<string, string>): void {
    if (werte.kennung !== neu.kennung) {
      setzeKennungVonHand(true);
      setzeNeu(werte);
      return;
    }
    setzeNeu(kennungVonHand ? werte : { ...werte, kennung: kennungAus(werte.name ?? "") });
  }

  async function anlegen(): Promise<void> {
    setzeLaeuft(true);
    setzeMeldung(null);
    try {
      const antwort = await hole("/admin/api/proxys", { method: "POST", body: JSON.stringify(neu) });
      const inhalt = (await antwort.json()) as { fehler?: string; verstoesse?: Verstoss[] };
      if (!antwort.ok) {
        setzeMeldung({ art: "schlecht", text: verstossText(inhalt) });
        return;
      }
      setzeNeu(LEERER_PROXY);
      setzeKennungVonHand(false);
      setzeFormularOffen(false);
      setzeMeldung({ art: "gut", text: "Der Proxy ist angelegt." });
      await neuLaden();
    } catch (fehler) {
      setzeMeldung({ art: "schlecht", text: `Der Server antwortet nicht: ${String(fehler)}` });
    } finally {
      setzeLaeuft(false);
    }
  }

  async function tun(pfad: string, methode: string, gutText: string): Promise<void> {
    setzeMeldung(null);
    try {
      const antwort = await hole(pfad, { method: methode });
      if (!antwort.ok) {
        const inhalt = (await antwort.json()) as { fehler?: string };
        setzeMeldung({ art: "schlecht", text: inhalt.fehler ?? "Das hat nicht geklappt." });
        return;
      }
      setzeMeldung({ art: "gut", text: gutText });
      await neuLaden();
    } catch (fehler) {
      setzeMeldung({ art: "schlecht", text: `Der Server antwortet nicht: ${String(fehler)}` });
    }
  }

  async function pruefen(kennung: string): Promise<void> {
    setzePruefungen((vorher) => ({ ...vorher, [kennung]: "Fragt das Zielsystem …" }));
    try {
      const antwort = await hole(`/admin/api/proxys/${kennung}/pruefung`, { method: "POST" });
      const inhalt = (await antwort.json()) as {
        erreichbar: boolean;
        status: number;
        koerper?: string;
        fehler?: string;
      };
      setzePruefungen((vorher) => ({
        ...vorher,
        [kennung]: inhalt.erreichbar
          ? `Antwortet ${inhalt.status}: ${inhalt.koerper ?? ""}`
          : `Nicht erreichbar: ${inhalt.fehler ?? `Status ${inhalt.status}`}`,
      }));
    } catch (fehler) {
      setzePruefungen((vorher) => ({ ...vorher, [kennung]: `Die Prüfung ist gescheitert: ${String(fehler)}` }));
    }
  }

  return (
    <>
      <div className="karte">
        <h2>Proxys</h2>
        <p className="hinweis">
          {proxys.length === 0
            ? "Noch kein Proxy angelegt. Ein Proxy braucht einen Namen und ein Zielsystem, danach ist er unter seiner eigenen Basis-URL erreichbar."
            : "Jeder Proxy reicht die zehn AAS-Aufrufe an sein eigenes Zielsystem weiter und ergänzt GET /shells und Discovery. Jeder liegt unter seiner eigenen Kennung."}
        </p>
        <Meldungsfeld meldung={meldung} />
      </div>

      {proxys.map((proxy) => (
        <div className={`karte ${proxy.kennung === gewaehlt ? "gewaehlt" : ""}`} key={proxy.kennung}>
          <h2>
            {proxy.name}
            {proxy.kennung === gewaehlt && <span className="schild gut abstand-links">Gewählt</span>}
          </h2>
          <p className="hinweis">
            Zielsystem {proxy.upstreamBasis} · GET /shells {proxy.shellsAktiv ? "an" : "aus"} · Registry{" "}
            {proxy.registryAktiv ? "an" : "aus"} · Submodel Registry {proxy.submodelRegistryAktiv ? "an" : "aus"} ·
            Dateipfade {proxy.dateiPfadeAbsolut ? "absolut" : "relativ"}
          </p>
          <div className="basis">
            <code>{proxy.basisUrl}</code>
            <Kopieren wert={proxy.basisUrl} was="Die Basis-URL wurde" />
          </div>
          <div className="knopfreihe abstand">
            <button className="tat" type="button" onClick={() => waehlen(proxy.kennung)} disabled={proxy.kennung === gewaehlt}>
              Auswählen
            </button>
            <a className="tat still" href={`${proxy.basisPfad}/swagger/index.html`} target="_blank" rel="noreferrer">
              Swagger öffnen
            </a>
            <button className="tat still" type="button" onClick={() => void pruefen(proxy.kennung)}>
              Prüfen
            </button>
            <button
              className="tat still"
              type="button"
              onClick={() => {
                if (window.confirm(`Den Proxy „${proxy.name}" wirklich löschen?`)) {
                  void tun(`/admin/api/proxys/${proxy.kennung}`, "DELETE", `„${proxy.name}" ist gelöscht.`);
                }
              }}
            >
              Löschen
            </button>
          </div>
          {pruefungen[proxy.kennung] !== undefined && <pre className="abstand">{pruefungen[proxy.kennung]}</pre>}
        </div>
      ))}

      <div className="karte">
        {formularOffen ? (
          <>
            <h2>Proxy anlegen</h2>
            <p className="hinweis">
              Die Kennung folgt dem Namen, bis man sie einmal selbst anfasst. Sie steht in der Adresse und ändert sich
              später nicht mehr von allein, damit sie den Aufrufern nicht wegbricht.
            </p>
            <ProxyFormular werte={neu} setzen={neuSetzen} />
            {(neu.kennung ?? "") !== "" && (
              <div className="basis">
                <code>/p/{neu.kennung}</code>
              </div>
            )}
            <div className="knopfreihe abstand">
              <button className="tat" type="button" onClick={() => void anlegen()} disabled={laeuft}>
                {laeuft ? "Legt an …" : "Anlegen"}
              </button>
              {proxys.length > 0 && (
                <button className="tat still" type="button" onClick={() => setzeFormularOffen(false)}>
                  Abbrechen
                </button>
              )}
            </div>
          </>
        ) : (
          <button className="tat" type="button" onClick={() => setzeFormularOffen(true)}>
            Proxy anlegen
          </button>
        )}
      </div>
    </>
  );
}

export function Einstellungen({
  proxy,
  neuLaden,
}: {
  proxy: ProxyAnsicht;
  neuLaden: () => Promise<void>;
}): React.ReactElement {
  const alsWerte = useCallback(
    (): Record<string, string> => ({
      name: proxy.name,
      kennung: proxy.kennung,
      upstreamBasis: proxy.upstreamBasis,
      aasBasis: proxy.aasBasis,
      zeitlimitMs: String(proxy.zeitlimitMs),
      pufferStunden: String(proxy.pufferStunden),
      shellsAktiv: String(proxy.shellsAktiv),
      registryAktiv: String(proxy.registryAktiv),
      submodelRegistryAktiv: String(proxy.submodelRegistryAktiv),
      dateiPfadeAbsolut: String(proxy.dateiPfadeAbsolut),
    }),
    [proxy],
  );

  const [entwurf, setzeEntwurf] = useState<Record<string, string>>(alsWerte);
  const [dienstBasis, setzeDienstBasis] = useState("");
  const [dienstEntwurf, setzeDienstEntwurf] = useState("");
  const [meldung, setzeMeldung] = useState<Meldung | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);

  useEffect(() => {
    setzeEntwurf(alsWerte());
    setzeMeldung(null);
  }, [alsWerte]);

  useEffect(() => {
    void (async () => {
      const antwort = await hole("/admin/api/einstellungen");
      if (!antwort.ok) return;
      const inhalt = (await antwort.json()) as { werte: { proxyBasis: string }; dienstBasis: string };
      setzeDienstBasis(inhalt.dienstBasis);
      setzeDienstEntwurf(inhalt.werte.proxyBasis);
    })();
  }, []);

  const geaendert = Object.keys(entwurf).some((feld) => entwurf[feld] !== alsWerte()[feld]);

  async function speichern(): Promise<void> {
    setzeLaeuft(true);
    setzeMeldung(null);
    try {
      const antwort = await hole(`/admin/api/proxys/${proxy.kennung}`, {
        method: "PUT",
        body: JSON.stringify(entwurf),
      });
      const inhalt = (await antwort.json()) as { fehler?: string; verstoesse?: Verstoss[] };
      if (!antwort.ok) {
        setzeMeldung({ art: "schlecht", text: verstossText(inhalt) });
        return;
      }
      setzeMeldung({ art: "gut", text: "Gespeichert." });
      await neuLaden();
    } catch (fehler) {
      setzeMeldung({ art: "schlecht", text: `Der Server antwortet nicht: ${String(fehler)}` });
    } finally {
      setzeLaeuft(false);
    }
  }

  async function dienstSpeichern(): Promise<void> {
    setzeMeldung(null);
    const antwort = await hole("/admin/api/einstellungen", {
      method: "PUT",
      body: JSON.stringify({ proxyBasis: dienstEntwurf }),
    });
    const inhalt = (await antwort.json()) as { fehler?: string; verstoesse?: Verstoss[]; dienstBasis?: string };
    if (!antwort.ok) {
      setzeMeldung({ art: "schlecht", text: verstossText(inhalt) });
      return;
    }
    setzeDienstBasis(inhalt.dienstBasis ?? dienstBasis);
    setzeMeldung({ art: "gut", text: "Gespeichert." });
    await neuLaden();
  }

  return (
    <>
      <div className="karte">
        <h2>Basis-URL von „{proxy.name}"</h2>
        <p className="hinweis">Diese Adresse tragen die Aufrufer anstelle der alten ein.</p>
        <div className="basis">
          <code>{proxy.basisUrl}</code>
          <Kopieren wert={proxy.basisUrl} was="Die Basis-URL wurde" />
        </div>
      </div>

      <div className="karte">
        <h2>Einstellungen dieses Proxys</h2>
        <ProxyFormular werte={entwurf} setzen={setzeEntwurf} />
        <div className="knopfreihe">
          <button className="tat" type="button" onClick={() => void speichern()} disabled={laeuft || !geaendert}>
            {laeuft ? "Speichert …" : "Speichern"}
          </button>
          <button className="tat still" type="button" onClick={() => setzeEntwurf(alsWerte())} disabled={!geaendert}>
            Verwerfen
          </button>
        </div>
        <Meldungsfeld meldung={meldung} />
      </div>

      <ItemIds proxy={proxy} neuLaden={neuLaden} />

      <div className="karte">
        <h2>Für alle Proxys</h2>
        <p className="hinweis">
          Die öffentliche Basis des ganzen Dienstes. Sie steht im servers-Block jeder Swagger-Seite. Bleibt sie leer,
          wird sie aus der Anfrage abgeleitet, derzeit {dienstBasis}.
        </p>
        <label>
          <span>
            Öffentliche Basis des Dienstes <em>Leer lassen ist der Normalfall.</em>
          </span>
          <input value={dienstEntwurf} onChange={(e) => setzeDienstEntwurf(e.target.value)} spellCheck={false} />
        </label>
        <button className="tat still" type="button" onClick={() => void dienstSpeichern()}>
          Speichern
        </button>
      </div>
    </>
  );
}

/** Eine Item-ID je Zeile; Leerraum, leere Zeilen und Doppelte fallen weg wie auf dem Server. */
export function zeilenAus(text: string): string[] {
  const zeilen = text.split(/\r?\n/).map((zeile) => zeile.trim());
  return [...new Set(zeilen.filter((zeile) => zeile !== ""))];
}

/** Dieselbe Regel wie in Discovery: die Kennung der Schale zu einer itemID. */
export function aasIdAus(aasBasis: string, itemId: string): string {
  return `${aasBasis}/aas?itemId=${encodeURIComponent(itemId)}`;
}

function zeitText(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

/** Ein Satz zum Stand des Bestands: wie viele Schalen, wann erneuert, wann wieder. */
export function erneuerungsStand(
  proxy: Pick<ProxyAnsicht, "pufferEintraege" | "erneuertAm" | "naechsteErneuerung" | "erneuerungLaeuft">,
): string {
  const teile = [`${proxy.pufferEintraege} ${proxy.pufferEintraege === 1 ? "Schale" : "Schalen"} im Bestand`];
  if (proxy.erneuerungLaeuft) teile.push("Erneuerung läuft");
  else if (proxy.erneuertAm === null) teile.push("noch nicht erneuert");
  else teile.push(`zuletzt erneuert ${zeitText(proxy.erneuertAm)}`);
  if (!proxy.erneuerungLaeuft && proxy.naechsteErneuerung !== null) {
    teile.push(`nächste Erneuerung ${zeitText(proxy.naechsteErneuerung)}`);
  }
  return `${teile.join(", ")}.`;
}

export function ItemIds({
  proxy,
  neuLaden,
}: {
  proxy: ProxyAnsicht;
  neuLaden: () => Promise<void>;
}): React.ReactElement {
  const [gespeichert, setzeGespeichert] = useState<string[] | null>(null);
  const [entwurf, setzeEntwurf] = useState("");
  const [meldung, setzeMeldung] = useState<Meldung | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);

  useEffect(() => {
    let gueltig = true;
    setzeGespeichert(null);
    setzeMeldung(null);
    void (async () => {
      try {
        const antwort = await hole(`/admin/api/proxys/${proxy.kennung}/items`);
        const inhalt = (await antwort.json()) as { itemIds?: string[]; fehler?: string };
        if (!gueltig) return;
        if (!antwort.ok || inhalt.itemIds === undefined) {
          setzeMeldung({ art: "schlecht", text: inhalt.fehler ?? "Die Liste ließ sich nicht laden." });
          return;
        }
        setzeGespeichert(inhalt.itemIds);
        setzeEntwurf(inhalt.itemIds.join("\n"));
      } catch (fehler) {
        if (gueltig) setzeMeldung({ art: "schlecht", text: `Der Server antwortet nicht: ${String(fehler)}` });
      }
    })();
    return () => {
      gueltig = false;
    };
  }, [proxy.kennung]);

  const zeilen = zeilenAus(entwurf);
  const geaendert = gespeichert !== null && zeilen.join("\n") !== gespeichert.join("\n");

  async function speichern(): Promise<void> {
    setzeLaeuft(true);
    setzeMeldung(null);
    try {
      const antwort = await hole(`/admin/api/proxys/${proxy.kennung}/items`, {
        method: "PUT",
        body: JSON.stringify({ itemIds: zeilen }),
      });
      const inhalt = (await antwort.json()) as { itemIds?: string[]; fehler?: string };
      if (!antwort.ok || inhalt.itemIds === undefined) {
        setzeMeldung({ art: "schlecht", text: inhalt.fehler ?? "Das hat nicht geklappt." });
        return;
      }
      setzeGespeichert(inhalt.itemIds);
      setzeEntwurf(inhalt.itemIds.join("\n"));
      setzeMeldung({ art: "gut", text: `Gespeichert, ${inhalt.itemIds.length} Item-IDs. Die Erneuerung läuft.` });
      // Das Speichern stoesst die Erneuerung an; die Uebersicht soll das zeigen.
      await neuLaden();
    } catch (fehler) {
      setzeMeldung({ art: "schlecht", text: `Der Server antwortet nicht: ${String(fehler)}` });
    } finally {
      setzeLaeuft(false);
    }
  }

  async function erneuern(): Promise<void> {
    setzeMeldung(null);
    try {
      const antwort = await hole(`/admin/api/proxys/${proxy.kennung}/erneuerung`, { method: "POST" });
      if (!antwort.ok) {
        const inhalt = (await antwort.json()) as { fehler?: string };
        setzeMeldung({ art: "schlecht", text: inhalt.fehler ?? "Die Erneuerung ließ sich nicht anstoßen." });
        return;
      }
      setzeMeldung({ art: "gut", text: "Die Erneuerung läuft. Den Stand zeigt die Übersicht nach dem Neuladen." });
      await neuLaden();
    } catch (fehler) {
      setzeMeldung({ art: "schlecht", text: `Der Server antwortet nicht: ${String(fehler)}` });
    }
  }

  const keinerAn = !proxy.shellsAktiv && !proxy.registryAktiv && !proxy.submodelRegistryAktiv;

  return (
    <div className="karte">
      <h2>Item-IDs für GET /shells und die Registries</h2>
      <p className="hinweis">
        Aus diesen Item-IDs bilden GET /shells, die Registry und die Submodel Registry ihre Listen, eine je Zeile. Das
        Zielsystem kennt das alles nicht, deshalb holt der Proxy alle Schalen selbst und erneuert sie{" "}
        {proxy.pufferStunden === 0
          ? "nicht: ohne Puffer geht jeder Aufruf nach oben"
          : `alle ${proxy.pufferStunden} ${proxy.pufferStunden === 1 ? "Stunde" : "Stunden"} auf einmal`}
        .
      </p>
      {keinerAn && (
        <p className="hinweis">
          GET /shells und beide Registries sind für diesen Proxy ausgeschaltet. Einschalten lassen sie sich oben in den
          Einstellungen.
        </p>
      )}
      <label>
        <span>
          Item-IDs <em>{gespeichert === null ? "Lädt …" : `${zeilen.length} Einträge`}</em>
        </span>
        <textarea
          rows={10}
          value={entwurf}
          onChange={(e) => setzeEntwurf(e.target.value)}
          spellCheck={false}
          disabled={gespeichert === null}
        />
      </label>
      {zeilen[0] !== undefined && (
        <p className="hinweis">
          Erzeugte AAS-ID der ersten Zeile: <code>{aasIdAus(proxy.aasBasis, zeilen[0])}</code>
        </p>
      )}
      <div className="knopfreihe">
        <button className="tat" type="button" onClick={() => void speichern()} disabled={laeuft || !geaendert}>
          {laeuft ? "Speichert …" : "Speichern"}
        </button>
        <button
          className="tat still"
          type="button"
          onClick={() => setzeEntwurf((gespeichert ?? []).join("\n"))}
          disabled={!geaendert}
        >
          Verwerfen
        </button>
        <button
          className="tat still"
          type="button"
          onClick={() => void erneuern()}
          disabled={keinerAn || proxy.pufferStunden === 0 || proxy.erneuerungLaeuft}
        >
          Jetzt erneuern
        </button>
      </div>
      <p className="hinweis">{erneuerungsStand(proxy)}</p>
      <Meldungsfeld meldung={meldung} />
    </div>
  );
}

interface Ergebnis {
  status: number;
  statusText: string;
  dauerMs: number;
  inhaltsart: string;
  groesse: number;
  text?: string;
  adresse?: string;
  istBild?: boolean;
  dateiname?: string;
  kopfzeilen: [string, string][];
  fehler?: string;
}

interface Eingabe {
  felder: Record<string, string>;
  kodieren: boolean;
  koerper: string;
}

const ABLAGE = "dti-proxy-api";

function vorgabeFuer(aufruf: Aufruf): Eingabe {
  const felder: Record<string, string> = {};
  for (const parameter of aufruf.parameter) felder[parameter.name] = parameter.vorgabe ?? "";
  return { felder, kodieren: true, koerper: aufruf.koerperVorgabe ?? "" };
}

function vorgaben(): Record<string, Eingabe> {
  const alle: Record<string, Eingabe> = {};
  for (const aufruf of AUFRUFE) alle[aufruf.id] = vorgabeFuer(aufruf);
  return alle;
}

function gemerkteEingaben(): Record<string, Eingabe> {
  const alle = vorgaben();
  try {
    const roh = window.localStorage.getItem(ABLAGE);
    if (roh === null) return alle;
    const gelesen = JSON.parse(roh) as Record<string, Partial<Eingabe>>;
    for (const aufruf of AUFRUFE) {
      const teil = gelesen[aufruf.id];
      if (teil === undefined) continue;
      alle[aufruf.id] = {
        felder: { ...alle[aufruf.id]!.felder, ...(teil.felder ?? {}) },
        kodieren: teil.kodieren ?? true,
        koerper: teil.koerper ?? alle[aufruf.id]!.koerper,
      };
    }
  } catch {
    // Eine leere oder gesperrte Ablage ist ein gültiger Zustand.
  }
  return alle;
}

function groesseAls(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusart(status: number): string {
  if (status >= 200 && status < 300) return "gut";
  if (status >= 400) return "schlecht";
  return "neutral";
}

function endungFuer(inhaltsart: string): string {
  if (inhaltsart.includes("aasx") || inhaltsart.includes("zip")) return "aasx";
  if (inhaltsart.includes("xml")) return "xml";
  if (inhaltsart.includes("json")) return "json";
  if (inhaltsart.includes("pdf")) return "pdf";
  const treffer = /image\/(\w+)/.exec(inhaltsart);
  return treffer?.[1] ?? "bin";
}

function AufrufFeld({
  parameter,
  wert,
  setzen,
}: {
  parameter: Parameter;
  wert: string;
  setzen: (neu: string) => void;
}): React.ReactElement {
  if (parameter.art === "schalter") {
    return (
      <label className="schalter">
        <input type="checkbox" checked={wert === "true"} onChange={(e) => setzen(e.target.checked ? "true" : "")} />
        <span>
          {parameter.titel}
          {parameter.hinweis !== undefined && <em>{parameter.hinweis}</em>}
        </span>
      </label>
    );
  }

  if (parameter.art === "auswahl") {
    return (
      <label>
        <span>
          {parameter.titel}
          {parameter.hinweis !== undefined && <em>{parameter.hinweis}</em>}
        </span>
        <select value={wert} onChange={(e) => setzen(e.target.value)}>
          <option value="">ohne Angabe</option>
          {parameter.werte?.map((moeglich) => (
            <option key={moeglich} value={moeglich}>
              {moeglich}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label>
      <span>
        {parameter.titel}
        {parameter.hinweis !== undefined && <em>{parameter.hinweis}</em>}
      </span>
      <input value={wert} onChange={(e) => setzen(e.target.value)} spellCheck={false} />
    </label>
  );
}

function Antwortfeld({ ergebnis }: { ergebnis: Ergebnis }): React.ReactElement {
  const [kopfzeilenOffen, setzeKopfzeilenOffen] = useState(false);

  if (ergebnis.fehler !== undefined) {
    return <div className="meldung schlecht">Die Anfrage ist gescheitert: {ergebnis.fehler}</div>;
  }

  return (
    <div className="antwort">
      <div className="antwortkopf">
        <span className={`schild ${statusart(ergebnis.status)}`}>
          {ergebnis.status} {ergebnis.statusText}
        </span>
        <span>{ergebnis.dauerMs} ms</span>
        <span>{ergebnis.inhaltsart === "" ? "ohne Inhaltsart" : ergebnis.inhaltsart}</span>
        <span>{groesseAls(ergebnis.groesse)}</span>
        <button className="verweis" type="button" onClick={() => setzeKopfzeilenOffen(!kopfzeilenOffen)}>
          {kopfzeilenOffen ? "Kopfzeilen verbergen" : "Kopfzeilen zeigen"}
        </button>
      </div>

      {kopfzeilenOffen && (
        <pre className="abstand">{ergebnis.kopfzeilen.map(([name, wert]) => `${name}: ${wert}`).join("\n")}</pre>
      )}

      {ergebnis.text !== undefined && (
        <pre className="abstand">{ergebnis.text === "" ? "(leerer Körper)" : ergebnis.text}</pre>
      )}

      {ergebnis.adresse !== undefined && (
        <div className="abstand">
          {ergebnis.istBild === true && <img className="vorschau" src={ergebnis.adresse} alt="Vorschaubild der Antwort" />}
          <div className="knopfreihe">
            <a className="tat still" href={ergebnis.adresse} download={ergebnis.dateiname}>
              Datei sichern
            </a>
            <span className="hinweis">
              Die Antwort ist keine Textantwort, deshalb steht hier die Datei statt ihrer Rohbytes.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ApiReiter({ proxy }: { proxy: ProxyAnsicht }): React.ReactElement {
  const [offen, setzeOffen] = useState<string | null>(null);
  const [autorisierung, setzeAutorisierung] = useState("");
  const [eingaben, setzeEingaben] = useState<Record<string, Eingabe>>(() => gemerkteEingaben());
  const [ergebnisse, setzeErgebnisse] = useState<Record<string, Ergebnis>>({});
  const [laufend, setzeLaufend] = useState<string | null>(null);
  const [meldung, setzeMeldung] = useState<Meldung | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(ABLAGE, JSON.stringify(eingaben));
    } catch {
      // Ohne Ablage funktioniert alles weiter, nur das Merken entfällt.
    }
  }, [eingaben]);

  const gruppen = useMemo(() => {
    const geordnet = new Map<string, Aufruf[]>();
    for (const aufruf of aufrufeFuer(proxy)) {
      const liste = geordnet.get(aufruf.gruppe) ?? [];
      liste.push(aufruf);
      geordnet.set(aufruf.gruppe, liste);
    }
    return [...geordnet.entries()];
  }, [proxy]);

  function aendern(id: string, teil: Partial<Eingabe>): void {
    setzeEingaben((vorher) => ({ ...vorher, [id]: { ...vorher[id]!, ...teil } }));
  }

  async function absenden(aufruf: Aufruf): Promise<void> {
    const eingabe = eingaben[aufruf.id]!;
    const url = urlBauen(aufruf, eingabe.felder, eingabe.kodieren, proxy.basisPfad);
    setzeLaufend(aufruf.id);

    const kopfzeilen: Record<string, string> = {};
    if (autorisierung.trim() !== "") kopfzeilen.authorization = autorisierung.trim();
    if (aufruf.methode === "POST") kopfzeilen["content-type"] = "application/json";

    const beginn = performance.now();
    try {
      const antwort = await fetch(url, {
        method: aufruf.methode,
        headers: kopfzeilen,
        body: aufruf.methode === "POST" ? eingabe.koerper : undefined,
        credentials: "same-origin",
      });
      const dauerMs = Math.round(performance.now() - beginn);
      const inhaltsart = antwort.headers.get("content-type") ?? "";
      const inhalt = await antwort.blob();

      const textartig = inhaltsart === "" || /json|text|xml|javascript|html/i.test(inhaltsart);
      const ergebnis: Ergebnis = {
        status: antwort.status,
        statusText: antwort.statusText,
        dauerMs,
        inhaltsart,
        groesse: inhalt.size,
        kopfzeilen: [...antwort.headers.entries()],
      };

      if (textartig) {
        const roh = await inhalt.text();
        try {
          ergebnis.text = JSON.stringify(JSON.parse(roh), null, 2);
        } catch {
          ergebnis.text = roh;
        }
      } else {
        ergebnis.adresse = URL.createObjectURL(inhalt);
        ergebnis.istBild = inhaltsart.startsWith("image/");
        ergebnis.dateiname = `${aufruf.id}.${endungFuer(inhaltsart)}`;
      }

      setzeErgebnisse((vorher) => {
        const alt = vorher[aufruf.id]?.adresse;
        if (alt !== undefined) URL.revokeObjectURL(alt);
        return { ...vorher, [aufruf.id]: ergebnis };
      });
    } catch (fehler) {
      setzeErgebnisse((vorher) => ({
        ...vorher,
        [aufruf.id]: {
          status: 0,
          statusText: "",
          dauerMs: Math.round(performance.now() - beginn),
          inhaltsart: "",
          groesse: 0,
          kopfzeilen: [],
          fehler: String(fehler),
        },
      }));
    } finally {
      setzeLaufend(null);
    }
  }

  function kopieren(text: string, was: string): void {
    void navigator.clipboard
      .writeText(text)
      .then(() => setzeMeldung({ art: "gut", text: `${was} kopiert.` }))
      .catch(() => setzeMeldung({ art: "schlecht", text: "Das Kopieren war nicht möglich." }));
  }

  return (
    <>
      <div className="karte">
        <h2>Die Aufrufe von „{proxy.name}" ausprobieren</h2>
        <p className="hinweis">
          Die Anfragen gehen an diesen Proxy, nicht an ihm vorbei, und zwar an {proxy.basisUrl}. Kennungen werden im
          Klartext eingegeben und auf Wunsch base64url kodiert, so wie die AAS-API sie erwartet. Der übliche Weg: unten
          Discovery aufrufen, das Ergebnis kopieren und oben als aasIdentifier einsetzen.
        </p>
        <label>
          <span>
            Authorization <em>Wird unverändert weitergereicht. Leer lassen, wenn das Zielsystem offen ist.</em>
          </span>
          <input
            value={autorisierung}
            onChange={(e) => setzeAutorisierung(e.target.value)}
            placeholder="Bearer …"
            spellCheck={false}
          />
        </label>
        <Meldungsfeld meldung={meldung} />
      </div>

      {gruppen.map(([gruppe, aufrufe]) => (
        <div className="karte" key={gruppe}>
          <h2>{gruppe}</h2>
          <div className="aufrufliste">
            {aufrufe.map((aufruf) => {
              const eingabe = eingaben[aufruf.id]!;
              const url = urlBauen(aufruf, eingabe.felder, eingabe.kodieren, proxy.basisPfad);
              const istOffen = offen === aufruf.id;
              const hatKennung = aufruf.parameter.some((p) => p.kennung === true);

              return (
                <div className={`aufruf ${istOffen ? "offen" : ""}`} key={aufruf.id}>
                  <button
                    className="aufrufzeile"
                    type="button"
                    aria-expanded={istOffen}
                    onClick={() => setzeOffen(istOffen ? null : aufruf.id)}
                  >
                    <span className={`methode ${aufruf.methode.toLowerCase()}`}>{aufruf.methode}</span>
                    <code>
                      {proxy.basisPfad}
                      {aufruf.vorlage}
                    </code>
                    <span className="pfeil">{istOffen ? "▲" : "▼"}</span>
                  </button>

                  {istOffen && (
                    <div className="aufrufinhalt">
                      <p className="hinweis">{aufruf.beschreibung}</p>

                      {aufruf.parameter.map((parameter) => (
                        <AufrufFeld
                          key={parameter.name}
                          parameter={parameter}
                          wert={eingabe.felder[parameter.name] ?? ""}
                          setzen={(neu) =>
                            aendern(aufruf.id, { felder: { ...eingabe.felder, [parameter.name]: neu } })
                          }
                        />
                      ))}

                      {hatKennung && (
                        <label className="schalter">
                          <input
                            type="checkbox"
                            checked={eingabe.kodieren}
                            onChange={(e) => aendern(aufruf.id, { kodieren: e.target.checked })}
                          />
                          <span>
                            Kennungen als base64url kodieren
                            <em>Ausschalten, wenn die Kennung bereits kodiert eingegeben wird.</em>
                          </span>
                        </label>
                      )}

                      {aufruf.koerperVorgabe !== undefined && (
                        <label>
                          <span>
                            Körper <em>JSON-Liste aus Bezeichnern, je mit name und value.</em>
                          </span>
                          <textarea
                            value={eingabe.koerper}
                            onChange={(e) => aendern(aufruf.id, { koerper: e.target.value })}
                            spellCheck={false}
                          />
                        </label>
                      )}

                      <div className="basis">
                        <code>
                          {aufruf.methode} {url}
                        </code>
                      </div>

                      <div className="knopfreihe">
                        <button
                          className="tat"
                          type="button"
                          onClick={() => void absenden(aufruf)}
                          disabled={laufend === aufruf.id}
                        >
                          {laufend === aufruf.id ? "Fragt …" : "Absenden"}
                        </button>
                        <button className="tat still" type="button" onClick={() => kopieren(url, "Die Adresse wurde")}>
                          Adresse kopieren
                        </button>
                        <button
                          className="tat still"
                          type="button"
                          onClick={() =>
                            kopieren(
                              curlBauen(aufruf, url, window.location.origin, eingabe.koerper, autorisierung),
                              "Der curl-Aufruf wurde",
                            )
                          }
                        >
                          Als curl kopieren
                        </button>
                        <button
                          className="tat still"
                          type="button"
                          onClick={() => setzeEingaben((vorher) => ({ ...vorher, [aufruf.id]: vorgabeFuer(aufruf) }))}
                        >
                          Felder zurücksetzen
                        </button>
                      </div>

                      {ergebnisse[aufruf.id] !== undefined && <Antwortfeld ergebnis={ergebnisse[aufruf.id]!} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

export function App(): React.ReactElement | null {
  const [sitzung, setzeSitzung] = useState<"laedt" | "aus" | "an">("laedt");
  const [reiter, setzeReiter] = useState<"uebersicht" | "einstellungen" | "api">("uebersicht");
  const [proxys, setzeProxys] = useState<ProxyAnsicht[] | null>(null);
  const [gewaehlt, setzeGewaehlt] = useState<string>("");

  const laden = useCallback(async (): Promise<void> => {
    const antwort = await hole("/admin/api/proxys");
    if (!antwort.ok) return;
    const inhalt = (await antwort.json()) as { proxys: ProxyAnsicht[] };
    setzeProxys(inhalt.proxys);
    // Die Auswahl wird an der Liste geprueft, nicht blind nachgehalten: ist
    // der gewaehlte Proxy weg, faellt sie auf den ersten zurueck.
    setzeGewaehlt((vorher) =>
      inhalt.proxys.some((p) => p.kennung === vorher) ? vorher : (inhalt.proxys[0]?.kennung ?? ""),
    );
  }, []);

  const pruefen = useCallback(async (): Promise<void> => {
    try {
      const antwort = await hole("/admin/api/sitzung");
      const inhalt = (await antwort.json()) as { angemeldet: boolean };
      setzeSitzung(inhalt.angemeldet ? "an" : "aus");
      if (inhalt.angemeldet) await laden();
    } catch {
      setzeSitzung("aus");
    }
  }, [laden]);

  useEffect(() => {
    void pruefen();
  }, [pruefen]);

  if (sitzung === "laedt") return null;
  if (sitzung === "aus") {
    return (
      <Anmeldung
        fertig={() => {
          setzeSitzung("an");
          void laden();
        }}
      />
    );
  }

  const aktiv = proxys?.find((p) => p.kennung === gewaehlt) ?? null;

  return (
    <div className="rahmen">
      <div className="kopf">
        <div>
          <h1>DTI Proxy</h1>
          <p>Zehn AAS-Aufrufe unverändert weitergereicht, dazu GET /shells aus gepflegten Item-IDs und Discovery nach SSP-001.</p>
        </div>
        <div className="knopfreihe">
          {proxys !== null && proxys.length > 0 && (
            <select value={gewaehlt} onChange={(e) => setzeGewaehlt(e.target.value)} className="auswahl">
              {proxys.map((proxy) => (
                <option key={proxy.kennung} value={proxy.kennung}>
                  {proxy.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="tat still"
            type="button"
            onClick={() => {
              void hole("/admin/api/abmelden", { method: "POST" }).finally(() => setzeSitzung("aus"));
            }}
          >
            Abmelden
          </button>
        </div>
      </div>

      <div className="reiter" role="tablist">
        <button role="tab" aria-selected={reiter === "uebersicht"} onClick={() => setzeReiter("uebersicht")}>
          Übersicht
        </button>
        <button role="tab" aria-selected={reiter === "einstellungen"} onClick={() => setzeReiter("einstellungen")}>
          Einstellungen
        </button>
        <button role="tab" aria-selected={reiter === "api"} onClick={() => setzeReiter("api")}>
          API
        </button>
      </div>

      {proxys === null && <div className="karte">Lädt …</div>}

      {proxys !== null && reiter === "uebersicht" && (
        <Uebersicht
          proxys={proxys}
          gewaehlt={gewaehlt}
          waehlen={(kennung) => setzeGewaehlt(kennung)}
          neuLaden={laden}
        />
      )}
      {proxys !== null && reiter !== "uebersicht" && aktiv === null && (
        <div className="karte">
          <h2>Kein Proxy gewählt</h2>
          <p className="hinweis">
            Einstellungen und API gehören immer zu einem bestimmten Proxy. In der Übersicht einen anlegen oder
            auswählen.
          </p>
          <button className="tat" type="button" onClick={() => setzeReiter("uebersicht")}>
            Zur Übersicht
          </button>
        </div>
      )}
      {proxys !== null && reiter === "einstellungen" && aktiv !== null && (
        <Einstellungen proxy={aktiv} neuLaden={laden} />
      )}
      {proxys !== null && reiter === "api" && aktiv !== null && <ApiReiter proxy={aktiv} />}
    </div>
  );
}
