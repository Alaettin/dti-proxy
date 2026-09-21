import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { appAnlegen } from "../src/app.js";
import { datenbankOeffnen } from "../src/db.js";
import { Einstellungen } from "../src/einstellungen.js";
import type { Uhr } from "../src/fehler.js";

/** Feste Uhr, damit Zeitstempel in Zusicherungen nicht mit der Zeit umfallen. */
export const FESTE_ZEIT = "2026-09-18T09:12:44.000Z";
export const festeUhr: Uhr = () => new Date(FESTE_ZEIT);

export const TEST_BENUTZER = "NeoAdmin";
export const TEST_PASSWORT = "Password!2026";
export const TEST_GEHEIMNIS = "geheimnis-nur-fuer-den-pruefstand";

export interface Aufruf {
  url: string;
  methode: string;
  kopfzeilen: Record<string, string>;
}

export interface Pruefstand {
  app: Express;
  einstellungen: Einstellungen;
  aufrufe: Aufruf[];
  schliessen: () => void;
}

export function pruefstand(
  antwort: (aufruf: Aufruf) => Response | Promise<Response> = () => new Response("{}", { status: 200 }),
  optionen: { webVerzeichnis?: string | null } = {},
): Pruefstand {
  const db = datenbankOeffnen(":memory:");
  const einstellungen = new Einstellungen(db);
  einstellungen.schreiben({ upstreamBasis: "https://oben.beispiel.test" });
  const aufrufe: Aufruf[] = [];

  const holen: typeof fetch = async (eingabe, init) => {
    const kopfzeilen: Record<string, string> = {};
    new Headers(init?.headers).forEach((wert, name) => {
      kopfzeilen[name.toLowerCase()] = wert;
    });
    const aufruf: Aufruf = { url: String(eingabe), methode: init?.method ?? "GET", kopfzeilen };
    aufrufe.push(aufruf);

    const geliefert = Promise.resolve(antwort(aufruf));
    const signal = init?.signal;
    if (!signal) return geliefert;
    // Echtes fetch bricht beim Signal ab. Ohne das hier misst der Zeitlimit-Test
    // die Attrappe statt den Code.
    return await Promise.race([
      geliefert,
      new Promise<Response>((_, scheitern) => {
        const abbrechen = (): void => {
          const fehler = new Error("This operation was aborted");
          fehler.name = "AbortError";
          scheitern(fehler);
        };
        if (signal.aborted) abbrechen();
        else signal.addEventListener("abort", abbrechen, { once: true });
      }),
    ]);
  };

  return {
    app: appAnlegen({
      einstellungen,
      holen,
      uhr: festeUhr,
      benutzer: TEST_BENUTZER,
      passwort: TEST_PASSWORT,
      geheimnis: TEST_GEHEIMNIS,
      // sicher bewusst nicht gesetzt: geprueft werden soll die Ableitung aus
      // der Verbindung, nicht ein im Pruefstand festgenagelter Wert.
      webVerzeichnis: optionen.webVerzeichnis ?? null,
    }),
    einstellungen,
    aufrufe,
    schliessen: () => db.close(),
  };
}

/**
 * Stellt eine Anfrage mit einem handgeschriebenen Pfad, an Superagent vorbei.
 * Nur so ist belegt, dass weder der Testclient noch Express den Pfad anfasst.
 */
export async function roheAnfrage(
  app: Express,
  pfad: string,
  optionen: { methode?: string; kopfzeilen?: Record<string, string>; koerper?: string } = {},
): Promise<{ status: number; koerper: string; kopfzeilen: http.IncomingHttpHeaders }> {
  const server = http.createServer(app);
  try {
    await new Promise<void>((fertig) => server.listen(0, "127.0.0.1", fertig));
    const port = (server.address() as AddressInfo).port;
    return await new Promise((fertig, scheitern) => {
      const anfrage = http.request(
        { host: "127.0.0.1", port, method: optionen.methode ?? "GET", path: pfad, headers: optionen.kopfzeilen },
        (antwort) => {
          let text = "";
          antwort.setEncoding("utf8");
          antwort.on("data", (teil) => (text += teil));
          antwort.on("end", () =>
            fertig({ status: antwort.statusCode ?? 0, koerper: text, kopfzeilen: antwort.headers }),
          );
        },
      );
      anfrage.on("error", scheitern);
      if (optionen.koerper !== undefined) anfrage.write(optionen.koerper);
      anfrage.end();
    });
  } finally {
    // Aufraeumen gehoert in finally, sonst verfaelscht ein haengender Server
    // den naechsten Lauf.
    await new Promise<void>((fertig) => server.close(() => fertig()));
  }
}
