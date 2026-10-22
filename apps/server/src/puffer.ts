import { GLEICHZEITIG, gedrosselt } from "./drossel.js";

/**
 * Puffer fuer GET /shells und die Registries. Ohne ihn kostet jede Seite
 * einen Aufruf oben je Item-ID, bei langen Listen dauert das zu lange.
 *
 * Je Proxy gibt es einen Bestand, der als Ganzes erneuert wird: alle Schalen
 * auf einmal, im Hintergrund, und erst am Ende ausgetauscht. So veraltet nie
 * ein Teil frueher als der Rest, und kein Aufrufer wartet auf einen kalten
 * Abruf. Den Zeitplan fuehrt erneuerung.ts.
 *
 * Gepuffert wird je Schale, nicht je Antwort. Der Schluessel enthaelt neben
 * der Kennung der Schale einen Fingerabdruck des Aufrufers, damit eine mit
 * Token geholte Schale nie an jemanden ohne Token geht.
 */

interface Eintrag {
  wert: Promise<unknown>;
  /** Erst fertig geladene Eintraege zaehlen und ueberleben eine Erneuerung. */
  fertig: boolean;
}

interface Bestand {
  eintraege: Map<string, Eintrag>;
  erneuertAm: number | null;
}

export interface Auftrag<T> {
  schluessel: string;
  laden: () => Promise<T>;
}

export class SchalenPuffer {
  #jetzt: () => number;
  #bestaende = new Map<number, Bestand>();

  constructor(jetzt: () => number = Date.now) {
    this.#jetzt = jetzt;
  }

  /**
   * Liefert den Wert aus dem Bestand. Fehlt er (erste Fuellung laeuft noch,
   * Item neu, Aufruf mit Token), wird er einzeln geladen und kommt in den
   * Bestand, wenn `behalten` zustimmt. Laufende Abrufe werden geteilt. Bei
   * `aktiv = false` ist der Puffer aus.
   */
  async holen<T>(
    proxyId: number,
    schluessel: string,
    aktiv: boolean,
    laden: () => Promise<T>,
    behalten: (wert: T) => boolean,
  ): Promise<T> {
    if (!aktiv) return laden();

    const eintraege = this.#bestandVon(proxyId).eintraege;
    const vorhanden = eintraege.get(schluessel);
    if (vorhanden !== undefined) return vorhanden.wert as Promise<T>;

    const eintrag: Eintrag = { wert: Promise.resolve(), fertig: false };
    const wert = laden().then(
      (geladen) => {
        // Inzwischen ausgetauscht oder geleert: dann nichts zurueckschreiben.
        if (this.#bestaende.get(proxyId)?.eintraege.get(schluessel) === eintrag) {
          if (behalten(geladen)) eintrag.fertig = true;
          else eintraege.delete(schluessel);
        }
        return geladen;
      },
      (fehler: unknown) => {
        if (eintraege.get(schluessel) === eintrag) eintraege.delete(schluessel);
        throw fehler;
      },
    );
    eintrag.wert = wert;
    eintraege.set(schluessel, eintrag);
    return wert;
  }

  /**
   * Baut einen neuen Bestand aus den Auftraegen und tauscht ihn erst am Ende
   * in einem Schritt aus. Scheitert ein Abruf oder will `behalten` ihn nicht,
   * bleibt der alte Eintrag stehen: lieber eine Schale von gestern als eine
   * Luecke. Was in keinem Auftrag vorkommt (entfernte Items, Eintraege mit
   * Token), faellt beim Tausch weg.
   */
  async erneuern<T>(proxyId: number, auftraege: Auftrag<T>[], behalten: (wert: T) => boolean): Promise<void> {
    const ergebnisse = await gedrosselt(
      auftraege.map((auftrag) => auftrag.laden),
      GLEICHZEITIG,
    );
    const bestand = this.#bestandVon(proxyId);
    const neu = new Map<string, Eintrag>();
    auftraege.forEach(({ schluessel }, nummer) => {
      const ergebnis = ergebnisse[nummer]!;
      if (ergebnis.status === "fulfilled" && behalten(ergebnis.value)) {
        neu.set(schluessel, { wert: Promise.resolve(ergebnis.value), fertig: true });
        return;
      }
      const alt = bestand.eintraege.get(schluessel);
      if (alt?.fertig) neu.set(schluessel, alt);
    });
    // Geleert, waehrend die Erneuerung lief: dann nicht wieder auferstehen lassen.
    if (this.#bestaende.get(proxyId) !== bestand) return;
    bestand.eintraege = neu;
    bestand.erneuertAm = this.#jetzt();
  }

  leeren(proxyId: number): void {
    this.#bestaende.delete(proxyId);
  }

  /** Zahl der fertig geladenen Eintraege eines Proxys. */
  anzahl(proxyId: number): number {
    const bestand = this.#bestaende.get(proxyId);
    if (bestand === undefined) return 0;
    let zahl = 0;
    for (const eintrag of bestand.eintraege.values()) if (eintrag.fertig) zahl += 1;
    return zahl;
  }

  erneuertAm(proxyId: number): number | null {
    return this.#bestaende.get(proxyId)?.erneuertAm ?? null;
  }

  #bestandVon(proxyId: number): Bestand {
    let bestand = this.#bestaende.get(proxyId);
    if (bestand === undefined) {
      bestand = { eintraege: new Map(), erneuertAm: null };
      this.#bestaende.set(proxyId, bestand);
    }
    return bestand;
  }
}
