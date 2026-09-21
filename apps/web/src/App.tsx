import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AUFRUFE, curlBauen, urlBauen, type Aufruf, type Parameter } from "./aufrufe.js";

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

const EINSTELLUNGSFELDER: { name: keyof Werte; titel: string; hinweis: string }[] = [
  { name: "upstreamBasis", titel: "Zielsystem", hinweis: "Dorthin gehen die zehn AAS-Aufrufe unverändert." },
  { name: "aasBasis", titel: "Basis der erzeugten AAS-IDs", hinweis: "Schema und Domain für /aas?itemId=…" },
  { name: "proxyBasis", titel: "Öffentliche Basis dieses Proxys", hinweis: "Steht im servers-Block der Swagger-Seite." },
  { name: "zeitlimitMs", titel: "Zeitlimit in Millisekunden", hinweis: "Zwischen 1000 und 300000." },
];

/**
 * Nur die Felder, ohne Laden und Speichern. Getrennt, damit sich das Formular
 * ansehen laesst, ohne dass vorher Daten eintreffen muessen.
 */
export function EinstellungsFormular({
  entwurf,
  setzen,
}: {
  entwurf: Werte;
  setzen: (neu: Werte) => void;
}): React.ReactElement {
  return (
    <>
      {EINSTELLUNGSFELDER.map(({ name, titel, hinweis }) => (
        <label key={name}>
          <span>
            {titel} <em>{hinweis}</em>
          </span>
          <input
            value={entwurf[name]}
            onChange={(e) => setzen({ ...entwurf, [name]: e.target.value })}
            spellCheck={false}
          />
        </label>
      ))}
    </>
  );
}

export function Einstellungen(): React.ReactElement {
  const [geladen, setzeGeladen] = useState<Geladen | null>(null);
  const [entwurf, setzeEntwurf] = useState<Werte | null>(null);
  const [meldung, setzeMeldung] = useState<Meldung | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);
  const [pruefung, setzePruefung] = useState<string | null>(null);

  const laden = useCallback(async (): Promise<void> => {
    const antwort = await hole("/admin/api/einstellungen");
    if (!antwort.ok) {
      setzeMeldung({ art: "schlecht", text: "Die Einstellungen konnten nicht geladen werden." });
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
    return <div className="karte">Lädt …</div>;
  }

  const geaendert = (Object.keys(entwurf) as (keyof Werte)[]).some((feld) => entwurf[feld] !== geladen.werte[feld]);

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
    setzePruefung("Fragt das Zielsystem …");
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
      setzePruefung(`Die Prüfung selbst ist gescheitert: ${String(fehler)}`);
    }
  }

  return (
    <>
      <div className="karte">
        <h2>Basis-URL dieses Proxys</h2>
        <p className="hinweis">
          Diese Adresse tragen die Aufrufer anstelle der alten ein. Sie steht auch im servers-Block der Swagger-Seite.
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
                .catch(() => setzeMeldung({ art: "schlecht", text: "Das Kopieren war nicht möglich." }));
            }}
          >
            Kopieren
          </button>
        </div>
      </div>

      <div className="karte">
        <h2>Einstellungen</h2>
        <p className="hinweis">
          Nur die öffentliche Basis darf leer bleiben, sie wird dann aus der Anfrage abgeleitet.
        </p>
        <EinstellungsFormular entwurf={entwurf} setzen={setzeEntwurf} />
        <div className="knopfreihe">
          <button className="tat" type="button" onClick={() => void speichern()} disabled={laeuft || !geaendert}>
            {laeuft ? "Speichert …" : "Speichern"}
          </button>
          <button className="tat still" type="button" onClick={() => setzeEntwurf(geladen.werte)} disabled={!geaendert}>
            Verwerfen
          </button>
          <button className="tat still" type="button" onClick={() => void verbindungPruefen()}>
            Verbindung prüfen
          </button>
          <a href="/swagger/index.html" target="_blank" rel="noreferrer">
            Swagger-Seite öffnen
          </a>
        </div>
        <Meldungsfeld meldung={meldung} />
        {pruefung !== null && <pre className="abstand">{pruefung}</pre>}
      </div>
    </>
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

      {ergebnis.text !== undefined && <pre className="abstand">{ergebnis.text === "" ? "(leerer Körper)" : ergebnis.text}</pre>}

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

export function ApiReiter(): React.ReactElement {
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
    for (const aufruf of AUFRUFE) {
      const liste = geordnet.get(aufruf.gruppe) ?? [];
      liste.push(aufruf);
      geordnet.set(aufruf.gruppe, liste);
    }
    return [...geordnet.entries()];
  }, []);

  function aendern(id: string, teil: Partial<Eingabe>): void {
    setzeEingaben((vorher) => ({ ...vorher, [id]: { ...vorher[id]!, ...teil } }));
  }

  async function absenden(aufruf: Aufruf): Promise<void> {
    const eingabe = eingaben[aufruf.id]!;
    const url = urlBauen(aufruf, eingabe.felder, eingabe.kodieren);
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
        <h2>Alle Aufrufe dieses Proxys ausprobieren</h2>
        <p className="hinweis">
          Die Anfragen gehen an diesen Proxy, nicht an ihm vorbei. Kennungen werden im Klartext eingegeben und auf
          Wunsch base64url kodiert, so wie die AAS-API sie erwartet. Der übliche Weg: unten Discovery aufrufen, das
          Ergebnis kopieren und oben als aasIdentifier einsetzen.
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
              const url = urlBauen(aufruf, eingabe.felder, eingabe.kodieren);
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
                    <code>{aufruf.vorlage}</code>
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
  const [reiter, setzeReiter] = useState<"einstellungen" | "api">("einstellungen");

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
          <p>Zehn AAS-Aufrufe unverändert weitergereicht, dazu Discovery nach SSP-001.</p>
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
        <button role="tab" aria-selected={reiter === "api"} onClick={() => setzeReiter("api")}>
          API
        </button>
      </div>

      {reiter === "einstellungen" ? <Einstellungen /> : <ApiReiter />}
    </div>
  );
}
