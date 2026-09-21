import { useCallback, useEffect, useState, type FormEvent } from "react";

interface Werte {
  upstreamBasis: string;
  proxyBasis: string;
  aasBasis: string;
  zeitlimitMs: string;
}

interface Geladen {
  werte: Werte;
  proxyBasisEffektiv: string;
}

interface Meldung {
  art: "gut" | "schlecht";
  text: string;
}

async function hole(pfad: string, optionen: RequestInit = {}): Promise<Response> {
  return fetch(pfad, {
    credentials: "same-origin",
    headers: optionen.body === undefined ? undefined : { "content-type": "application/json" },
    ...optionen,
  });
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
      setzeMeldung({ art: "schlecht", text: inhalt.fehler ?? "Anmeldung fehlgeschlagen." });
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
        <p className="hinweis">Verwaltung, bitte anmelden.</p>
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
            {laeuft ? "Prueft ..." : "Anmelden"}
          </button>
          <Meldungsfeld meldung={meldung} />
        </form>
      </div>
    </div>
  );
}

function Einstellungen(): React.ReactElement {
  const [geladen, setzeGeladen] = useState<Geladen | null>(null);
  const [entwurf, setzeEntwurf] = useState<Werte | null>(null);
  const [meldung, setzeMeldung] = useState<Meldung | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);
  const [pruefung, setzePruefung] = useState<string | null>(null);

  const laden = useCallback(async (): Promise<void> => {
    const antwort = await hole("/admin/api/einstellungen");
    if (!antwort.ok) {
      setzeMeldung({ art: "schlecht", text: "Einstellungen konnten nicht geladen werden." });
      return;
    }
    const inhalt = (await antwort.json()) as Geladen;
    setzeGeladen(inhalt);
    setzeEntwurf(inhalt.werte);
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  if (geladen === null || entwurf === null) {
    return <div className="karte">Laedt ...</div>;
  }

  const geaendert = (Object.keys(entwurf) as (keyof Werte)[]).some((feld) => entwurf[feld] !== geladen.werte[feld]);

  function feld(name: keyof Werte, titel: string, hinweis: string): React.ReactElement {
    return (
      <label>
        <span>
          {titel} · {hinweis}
        </span>
        <input
          value={entwurf![name]}
          onChange={(e) => setzeEntwurf({ ...entwurf!, [name]: e.target.value })}
          spellCheck={false}
        />
      </label>
    );
  }

  async function speichern(): Promise<void> {
    setzeLaeuft(true);
    setzeMeldung(null);
    try {
      const antwort = await hole("/admin/api/einstellungen", { method: "PUT", body: JSON.stringify(entwurf) });
      const inhalt = (await antwort.json()) as Geladen & {
        fehler?: string;
        verstoesse?: { feld: string; text: string }[];
      };
      if (!antwort.ok) {
        const texte = inhalt.verstoesse?.map((v) => v.text).join(" ") ?? inhalt.fehler ?? "Unbekannter Fehler.";
        setzeMeldung({ art: "schlecht", text: texte });
        return;
      }
      setzeGeladen({ werte: inhalt.werte, proxyBasisEffektiv: inhalt.proxyBasisEffektiv });
      setzeEntwurf(inhalt.werte);
      setzeMeldung({ art: "gut", text: "Gespeichert." });
    } catch (fehler) {
      setzeMeldung({ art: "schlecht", text: `Der Server antwortet nicht: ${String(fehler)}` });
    } finally {
      setzeLaeuft(false);
    }
  }

  async function verbindungPruefen(): Promise<void> {
    setzePruefung("Fragt das Zielsystem ...");
    try {
      const antwort = await hole("/admin/api/pruefung", { method: "POST" });
      const inhalt = (await antwort.json()) as {
        erreichbar: boolean;
        status: number;
        koerper?: string;
        fehler?: string;
      };
      setzePruefung(
        inhalt.erreichbar
          ? `GET ${geladen!.werte.upstreamBasis}/description antwortet ${inhalt.status}\n${inhalt.koerper ?? ""}`
          : `Nicht erreichbar: ${inhalt.fehler ?? `Status ${inhalt.status}`}`,
      );
    } catch (fehler) {
      setzePruefung(`Die Pruefung selbst ist gescheitert: ${String(fehler)}`);
    }
  }

  return (
    <>
      <div className="karte">
        <h2>Basis-URL dieses Proxys</h2>
        <p className="hinweis">
          Diese Adresse tragen die Aufrufer statt der alten ein. Sie steht auch im servers-Block der Swagger-Seite.
        </p>
        <div className="basis">
          <code>{geladen.proxyBasisEffektiv}</code>
          <button
            className="tat still"
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(geladen.proxyBasisEffektiv)
                .then(() => setzeMeldung({ art: "gut", text: "Basis-URL kopiert." }))
                .catch(() => setzeMeldung({ art: "schlecht", text: "Kopieren war nicht moeglich." }));
            }}
          >
            Kopieren
          </button>
        </div>
      </div>

      <div className="karte">
        <h2>Einstellungen</h2>
        <p className="hinweis">Leer lassen heisst: Vorgabe verwenden.</p>
        {feld("upstreamBasis", "Ziel der alten Funktionen", "dorthin gehen die zehn AAS-Aufrufe unveraendert")}
        {feld("aasBasis", "Basis der gebauten AAS-IDs", "Schema und Domain fuer /aas?itemId=...")}
        {feld("proxyBasis", "Oeffentliche Basis des Proxys", "leer: aus der Anfrage ableiten")}
        {feld("zeitlimitMs", "Zeitlimit in Millisekunden", "1000 bis 300000")}
        <div className="knopfreihe">
          <button className="tat" type="button" onClick={() => void speichern()} disabled={laeuft || !geaendert}>
            {laeuft ? "Speichert ..." : "Speichern"}
          </button>
          <button className="tat still" type="button" onClick={() => setzeEntwurf(geladen.werte)} disabled={!geaendert}>
            Verwerfen
          </button>
          <button className="tat still" type="button" onClick={() => void verbindungPruefen()}>
            Verbindung pruefen
          </button>
          <a href="/swagger/index.html" target="_blank" rel="noreferrer">
            Swagger-Seite oeffnen
          </a>
        </div>
        <Meldungsfeld meldung={meldung} />
        {pruefung !== null && <pre style={{ marginTop: 14 }}>{pruefung}</pre>}
      </div>
    </>
  );
}

function DiscoveryTest(): React.ReactElement {
  const [wert, setzeWert] = useState("https://viewer-pf.test.dti.neoception.dev/70133076");
  const [ausgabe, setzeAusgabe] = useState<string | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);

  async function abschicken(): Promise<void> {
    setzeLaeuft(true);
    const koerper = JSON.stringify([{ name: "globalAssetId", value: wert }], null, 2);
    try {
      const antwort = await hole("/lookup/shellsByAssetLink", { method: "POST", body: koerper });
      const text = await antwort.text();
      setzeAusgabe(
        `POST /lookup/shellsByAssetLink\n${koerper}\n\n--- Antwort ${antwort.status} ---\n${text}`,
      );
    } catch (fehler) {
      setzeAusgabe(`Die Anfrage ist gescheitert: ${String(fehler)}`);
    } finally {
      setzeLaeuft(false);
    }
  }

  return (
    <div className="karte">
      <h2>Discovery ausprobieren</h2>
      <p className="hinweis">
        Aus der globalAssetId wird die itemID gezogen, davor kommt die eingestellte Basis, dahinter /aas?itemId=...
      </p>
      <label>
        <span>globalAssetId</span>
        <input value={wert} onChange={(e) => setzeWert(e.target.value)} spellCheck={false} />
      </label>
      <button className="tat" type="button" onClick={() => void abschicken()} disabled={laeuft}>
        {laeuft ? "Fragt ..." : "Abschicken"}
      </button>
      {ausgabe !== null && <pre style={{ marginTop: 16 }}>{ausgabe}</pre>}
    </div>
  );
}

export function App(): React.ReactElement | null {
  const [sitzung, setzeSitzung] = useState<"laedt" | "aus" | "an">("laedt");
  const [reiter, setzeReiter] = useState<"einstellungen" | "test">("einstellungen");

  const pruefen = useCallback(async (): Promise<void> => {
    try {
      const antwort = await hole("/admin/api/sitzung");
      const inhalt = (await antwort.json()) as { angemeldet: boolean };
      setzeSitzung(inhalt.angemeldet ? "an" : "aus");
    } catch {
      setzeSitzung("aus");
    }
  }, []);

  useEffect(() => {
    void pruefen();
  }, [pruefen]);

  if (sitzung === "laedt") return null;
  if (sitzung === "aus") return <Anmeldung fertig={() => setzeSitzung("an")} />;

  return (
    <div className="rahmen">
      <div className="kopf">
        <div>
          <h1>DTI Proxy</h1>
          <p>Die zehn AAS-Aufrufe unveraendert, plus Discovery nach SSP-001.</p>
        </div>
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

      <div className="reiter" role="tablist">
        <button role="tab" aria-selected={reiter === "einstellungen"} onClick={() => setzeReiter("einstellungen")}>
          Einstellungen
        </button>
        <button role="tab" aria-selected={reiter === "test"} onClick={() => setzeReiter("test")}>
          Discovery-Test
        </button>
      </div>

      {reiter === "einstellungen" ? <Einstellungen /> : <DiscoveryTest />}
    </div>
  );
}
