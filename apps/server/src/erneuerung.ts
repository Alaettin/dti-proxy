import type { Proxy, Proxys } from "./proxys.js";
import type { SchalenPuffer } from "./puffer.js";
import { behalten, erneuerungsAuftraege } from "./schalen.js";

/** Die Pufferdauer wird in Stunden eingestellt. */
export const STUNDE_MS = 60 * 60 * 1000;

/**
 * Wie oft der Takt nachsieht, ob ein Proxy faellig ist. Ein Takt statt eines
 * Weckers ueber die volle Dauer: 720 Stunden liegen ueber der Grenze von
 * setTimeout (2^31 ms, gut 24 Tage), und ein Takt stirbt nicht zwischen
 * Loeschen und Neuanlegen eines Weckers.
 */
export const TAKT_MS = 60 * 1000;

/** Laeufe im Hintergrund hat niemand, der auf sie wartet: ein Fehler muss ins Protokoll, nicht ins Leere. */
export function melden(fehler: unknown): void {
  console.error("Erneuerung gescheitert:", fehler);
}

export interface ErneuerungsStand {
  erneuertAm: number | null;
  naechsteErneuerung: number | null;
  laeuft: boolean;
}

export interface ErneuererOptionen {
  proxys: Proxys;
  puffer: SchalenPuffer;
  holen?: typeof fetch;
  jetzt?: () => number;
}

/**
 * Erneuert den Bestand jedes Proxys als Ganzes im Hintergrund: alle Schalen
 * zum gleichen Zeitpunkt, alle `pufferStunden`. Faellig ist ein Proxy, wenn
 * er puffert und mindestens einen der eigenen Wege anbietet.
 */
export class Erneuerer {
  #proxys: Proxys;
  #puffer: SchalenPuffer;
  #holen: typeof fetch;
  #jetzt: () => number;
  /** Naechste Erneuerung je Proxy. Fehlt ein Eintrag, ist der Proxy sofort faellig. */
  #plan = new Map<number, number>();
  #laufend = new Map<number, Promise<void>>();
  /** Waehrend einer Erneuerung angestossen: danach gleich noch einmal, mit dem neuen Stand. */
  #nachlauf = new Set<number>();
  #takt: ReturnType<typeof setInterval> | null = null;

  constructor({ proxys, puffer, holen = fetch, jetzt = Date.now }: ErneuererOptionen) {
    this.#proxys = proxys;
    this.#puffer = puffer;
    this.#holen = holen;
    this.#jetzt = jetzt;
  }

  static beteiligt(proxy: Proxy): boolean {
    return proxy.pufferStunden > 0 && (proxy.shellsAktiv || proxy.registryAktiv || proxy.submodelRegistryAktiv);
  }

  /** Startet den Takt. Alle beteiligten Proxys sind dabei sofort faellig. */
  starten(): void {
    if (this.#takt !== null) return;
    this.faelligePruefen().catch(melden);
    this.#takt = setInterval(() => this.faelligePruefen().catch(melden), TAKT_MS);
    this.#takt.unref();
  }

  stoppen(): void {
    if (this.#takt !== null) clearInterval(this.#takt);
    this.#takt = null;
  }

  /** Erneuert jeden faelligen Proxy und raeumt die Bestaende der nicht beteiligten weg. */
  async faelligePruefen(): Promise<void> {
    const jetzt = this.#jetzt();
    const laeufe: Promise<void>[] = [];
    for (const proxy of this.#proxys.alle()) {
      const id = this.#proxys.idVon(proxy.kennung);
      if (id === null) continue;
      if (!Erneuerer.beteiligt(proxy)) {
        this.#vergessen(id);
        continue;
      }
      if ((this.#plan.get(id) ?? jetzt) <= jetzt) laeufe.push(this.#erneuern(id));
    }
    await Promise.all(laeufe);
  }

  /**
   * Erneuert einen Proxy sofort, etwa nach geaenderten Item-IDs oder auf
   * Knopfdruck. Mit `verwerfen` geht der alte Bestand vorher weg, weil er von
   * einem anderen Zielsystem stammt. Nicht beteiligt: Bestand weg.
   */
  anstossen(kennung: string, { verwerfen = false }: { verwerfen?: boolean } = {}): Promise<void> {
    const proxy = this.#proxys.nachKennung(kennung);
    const id = this.#proxys.idVon(kennung);
    if (proxy === null || id === null) return Promise.resolve();
    if (!Erneuerer.beteiligt(proxy)) {
      this.#vergessen(id);
      return Promise.resolve();
    }
    if (verwerfen) this.#puffer.leeren(id);
    return this.#erneuern(id);
  }

  /** Wartet, bis keine Erneuerung mehr laeuft, Nachlaeufe eingeschlossen. */
  async abgeschlossen(): Promise<void> {
    while (this.#laufend.size > 0) await Promise.allSettled([...this.#laufend.values()]);
  }

  /** Fuer einen geloeschten Proxy: Plan und Bestand weg. */
  vergessen(proxyId: number): void {
    this.#vergessen(proxyId);
  }

  stand(proxyId: number): ErneuerungsStand {
    return {
      erneuertAm: this.#puffer.erneuertAm(proxyId),
      naechsteErneuerung: this.#laufend.has(proxyId) ? null : (this.#plan.get(proxyId) ?? null),
      laeuft: this.#laufend.has(proxyId),
    };
  }

  #vergessen(proxyId: number): void {
    this.#plan.delete(proxyId);
    this.#nachlauf.delete(proxyId);
    this.#puffer.leeren(proxyId);
  }

  #erneuern(proxyId: number): Promise<void> {
    const laufend = this.#laufend.get(proxyId);
    if (laufend !== undefined) {
      this.#nachlauf.add(proxyId);
      return laufend;
    }
    const lauf = this.#einmalErneuern(proxyId).finally(() => {
      this.#laufend.delete(proxyId);
      if (this.#nachlauf.delete(proxyId)) this.#erneuern(proxyId).catch(melden);
    });
    this.#laufend.set(proxyId, lauf);
    return lauf;
  }

  async #einmalErneuern(proxyId: number): Promise<void> {
    // Den Proxy jedes Mal frisch lesen: Basen, Dauer und Item-IDs koennen sich geaendert haben.
    const proxy = this.#proxys.alle().find((eintrag) => this.#proxys.idVon(eintrag.kennung) === proxyId);
    if (proxy === undefined || !Erneuerer.beteiligt(proxy)) {
      this.#vergessen(proxyId);
      return;
    }
    const itemIds = this.#proxys.itemIds(proxy.kennung) ?? [];
    try {
      await this.#puffer.erneuern(proxyId, erneuerungsAuftraege(proxy, itemIds, this.#holen), behalten);
    } finally {
      this.#plan.set(proxyId, this.#jetzt() + proxy.pufferStunden * STUNDE_MS);
    }
  }
}
