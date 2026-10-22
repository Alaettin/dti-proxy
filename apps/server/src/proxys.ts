import type { Datenbank } from "./db.js";
import { PROXY_VORGABEN } from "./db.js";
import { basisPruefen } from "./einstellungen.js";

export type ProxyFeld =
  | "kennung"
  | "name"
  | "upstreamBasis"
  | "aasBasis"
  | "zeitlimitMs"
  | "pufferStunden"
  | "shellsAktiv"
  | "registryAktiv"
  | "submodelRegistryAktiv";

/** Die drei Wege, die der Proxy selbst bedient und die sich je Proxy schalten lassen. */
export const SCHALTER = ["shellsAktiv", "registryAktiv", "submodelRegistryAktiv"] as const;
export type Schalter = (typeof SCHALTER)[number];

const SCHALTER_NAMEN: Record<Schalter, string> = {
  shellsAktiv: "GET /shells",
  registryAktiv: "Die Registry",
  submodelRegistryAktiv: "Die Submodel Registry",
};

export interface ProxyVerstoss {
  feld: ProxyFeld;
  text: string;
}

export interface Proxy {
  kennung: string;
  name: string;
  upstreamBasis: string;
  aasBasis: string;
  zeitlimitMs: number;
  /** Wie lange GET /shells eine Schale von oben behaelt, in Stunden. 0 schaltet den Puffer ab. */
  pufferStunden: number;
  /** Ob dieser Proxy GET /shells anbietet. Aus heisst: der Weg wird gar nicht bedient. */
  shellsAktiv: boolean;
  /** Ob dieser Proxy die Registry (GET /shell-descriptors) anbietet. */
  registryAktiv: boolean;
  /** Ob dieser Proxy die Submodel Registry (GET /submodel-descriptors) anbietet. */
  submodelRegistryAktiv: boolean;
  angelegtAm: string;
}

/** So liegt ein Proxy in der Tabelle: SQLite kennt kein boolean. */
type ProxyZeile = Omit<Proxy, Schalter> & Record<Schalter, number>;

function ausZeile(zeile: ProxyZeile): Proxy {
  return {
    ...zeile,
    shellsAktiv: zeile.shellsAktiv === 1,
    registryAktiv: zeile.registryAktiv === 1,
    submodelRegistryAktiv: zeile.submodelRegistryAktiv === 1,
  };
}

export interface ProxyEingabe {
  kennung?: string;
  name?: string;
  upstreamBasis?: string;
  aasBasis?: string;
  zeitlimitMs?: string | number;
  pufferStunden?: string | number;
  shellsAktiv?: string | boolean;
  registryAktiv?: string | boolean;
  submodelRegistryAktiv?: string | boolean;
}

const KENNUNG_MUSTER = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const KENNUNG_MAX = 40;

/**
 * Aus einem Namen einen Vorschlag machen. Nur ein Vorschlag: die Kennung steht
 * in Adressen und soll aenderbar bleiben.
 */
export function kennungAus(name: string): string {
  const roh = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return roh.slice(0, KENNUNG_MAX).replace(/-+$/, "");
}

export function kennungPruefen(roh: string): { wert: string } | { text: string } {
  const wert = roh.trim();
  if (wert === "") return { text: "Die Kennung darf nicht leer sein." };
  if (wert.length > KENNUNG_MAX) return { text: `Die Kennung darf höchstens ${KENNUNG_MAX} Zeichen haben.` };
  if (!KENNUNG_MUSTER.test(wert)) {
    return {
      text: "Die Kennung darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten und muss mit einem Buchstaben oder einer Ziffer beginnen und enden.",
    };
  }
  return { wert };
}

function zeitlimitPruefen(roh: string | number): { wert: number } | { text: string } {
  const zahl = Number(roh);
  if (!Number.isInteger(zahl) || zahl < 1000 || zahl > 300_000) {
    return { text: "Das Zeitlimit muss eine ganze Zahl zwischen 1000 und 300000 sein." };
  }
  return { wert: zahl };
}

/** 30 Tage. Laenger behaelt niemand eine Schale, ohne es zu merken. */
export const PUFFER_STUNDEN_MAX = 720;
export const ITEMS_MAX = 10_000;
export const ITEM_LAENGE_MAX = 2048;

function pufferPruefen(roh: string | number): { wert: number } | { text: string } {
  const zahl = typeof roh === "string" && roh.trim() === "" ? Number.NaN : Number(roh);
  if (!Number.isInteger(zahl) || zahl < 0 || zahl > PUFFER_STUNDEN_MAX) {
    return { text: `Die Pufferdauer muss eine ganze Zahl zwischen 0 und ${PUFFER_STUNDEN_MAX} Stunden sein.` };
  }
  return { wert: zahl };
}

/** Die Oberflaeche schickt Formularwerte als Text, deshalb auch "true" und "false". */
function schalterPruefen(roh: string | boolean, was: string): { wert: boolean } | { text: string } {
  if (roh === true || roh === "true") return { wert: true };
  if (roh === false || roh === "false") return { wert: false };
  return { text: `${was} lässt sich nur ein- oder ausschalten.` };
}

const SPALTEN =
  "kennung, name, upstreamBasis, aasBasis, zeitlimitMs, pufferStunden, shellsAktiv, registryAktiv, " +
  "submodelRegistryAktiv, angelegtAm";

export class Proxys {
  #db: Datenbank;

  constructor(db: Datenbank) {
    this.#db = db;
  }

  alle(): Proxy[] {
    const zeilen = this.#db.prepare(`SELECT ${SPALTEN} FROM proxys ORDER BY angelegtAm ASC, id ASC`).all();
    return (zeilen as ProxyZeile[]).map(ausZeile);
  }

  nachKennung(kennung: string): Proxy | null {
    const zeile = this.#db.prepare(`SELECT ${SPALTEN} FROM proxys WHERE kennung = ?`).get(kennung) as
      | ProxyZeile
      | undefined;
    return zeile === undefined ? null : ausZeile(zeile);
  }

  anzahl(): number {
    return (this.#db.prepare("SELECT COUNT(*) AS zahl FROM proxys").get() as { zahl: number }).zahl;
  }

  /**
   * Prueft die Eingabe. `bestand` ist der bisherige Eintrag beim Aendern,
   * beim Anlegen null: nur dann sind alle Felder Pflicht.
   */
  #pruefen(eingabe: ProxyEingabe, bestand: Proxy | null): { werte: Proxy } | { verstoesse: ProxyVerstoss[] } {
    const verstoesse: ProxyVerstoss[] = [];

    const name = (eingabe.name ?? bestand?.name ?? "").trim();
    if (name === "") verstoesse.push({ feld: "name", text: "Der Name darf nicht leer sein." });

    let kennung = bestand?.kennung ?? "";
    if (eingabe.kennung !== undefined || bestand === null) {
      const geprueft = kennungPruefen(eingabe.kennung ?? "");
      if ("text" in geprueft) verstoesse.push({ feld: "kennung", text: geprueft.text });
      else kennung = geprueft.wert;
    }

    const basen: Record<"upstreamBasis" | "aasBasis", string> = {
      upstreamBasis: bestand?.upstreamBasis ?? "",
      aasBasis: bestand?.aasBasis ?? "",
    };
    for (const feld of ["upstreamBasis", "aasBasis"] as const) {
      const roh = eingabe[feld];
      if (roh === undefined && bestand !== null) continue;
      const geprueft = basisPruefen(feld, roh ?? "");
      if ("text" in geprueft) verstoesse.push({ feld, text: geprueft.text });
      else basen[feld] = geprueft.wert;
    }

    let zeitlimitMs = bestand?.zeitlimitMs ?? PROXY_VORGABEN.zeitlimitMs;
    if (eingabe.zeitlimitMs !== undefined || bestand === null) {
      const geprueft = zeitlimitPruefen(eingabe.zeitlimitMs ?? PROXY_VORGABEN.zeitlimitMs);
      if ("text" in geprueft) verstoesse.push({ feld: "zeitlimitMs", text: geprueft.text });
      else zeitlimitMs = geprueft.wert;
    }

    let pufferStunden = bestand?.pufferStunden ?? PROXY_VORGABEN.pufferStunden;
    if (eingabe.pufferStunden !== undefined) {
      const geprueft = pufferPruefen(eingabe.pufferStunden);
      if ("text" in geprueft) verstoesse.push({ feld: "pufferStunden", text: geprueft.text });
      else pufferStunden = geprueft.wert;
    }

    const schalter = {} as Record<Schalter, boolean>;
    for (const feld of SCHALTER) {
      schalter[feld] = bestand?.[feld] ?? PROXY_VORGABEN[feld];
      const roh = eingabe[feld];
      if (roh === undefined) continue;
      const geprueft = schalterPruefen(roh, SCHALTER_NAMEN[feld]);
      if ("text" in geprueft) verstoesse.push({ feld, text: geprueft.text });
      else schalter[feld] = geprueft.wert;
    }

    if (verstoesse.length > 0) return { verstoesse };

    const fremd = this.nachKennung(kennung);
    if (fremd !== null && fremd.kennung !== bestand?.kennung) {
      return { verstoesse: [{ feld: "kennung", text: `Die Kennung „${kennung}" ist schon vergeben.` }] };
    }

    return {
      werte: {
        kennung,
        name,
        upstreamBasis: basen.upstreamBasis,
        aasBasis: basen.aasBasis,
        zeitlimitMs,
        pufferStunden,
        ...schalter,
        angelegtAm: bestand?.angelegtAm ?? new Date().toISOString(),
      },
    };
  }

  anlegen(eingabe: ProxyEingabe): { proxy: Proxy } | { verstoesse: ProxyVerstoss[] } {
    const geprueft = this.#pruefen(eingabe, null);
    if ("verstoesse" in geprueft) return geprueft;
    const werte = geprueft.werte;
    this.#db
      .prepare(
        `INSERT INTO proxys (kennung, name, upstreamBasis, aasBasis, zeitlimitMs, pufferStunden, shellsAktiv,
           registryAktiv, submodelRegistryAktiv, angelegtAm)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        werte.kennung,
        werte.name,
        werte.upstreamBasis,
        werte.aasBasis,
        werte.zeitlimitMs,
        werte.pufferStunden,
        werte.shellsAktiv ? 1 : 0,
        werte.registryAktiv ? 1 : 0,
        werte.submodelRegistryAktiv ? 1 : 0,
        werte.angelegtAm,
      );
    return { proxy: werte };
  }

  aendern(kennung: string, eingabe: ProxyEingabe): { proxy: Proxy } | { verstoesse: ProxyVerstoss[] } | null {
    const bestand = this.nachKennung(kennung);
    if (bestand === null) return null;
    const geprueft = this.#pruefen(eingabe, bestand);
    if ("verstoesse" in geprueft) return geprueft;
    const werte = geprueft.werte;
    this.#db
      .prepare(
        `UPDATE proxys SET kennung = ?, name = ?, upstreamBasis = ?, aasBasis = ?, zeitlimitMs = ?, pufferStunden = ?,
           shellsAktiv = ?, registryAktiv = ?, submodelRegistryAktiv = ?
         WHERE kennung = ?`,
      )
      .run(
        werte.kennung,
        werte.name,
        werte.upstreamBasis,
        werte.aasBasis,
        werte.zeitlimitMs,
        werte.pufferStunden,
        werte.shellsAktiv ? 1 : 0,
        werte.registryAktiv ? 1 : 0,
        werte.submodelRegistryAktiv ? 1 : 0,
        kennung,
      );
    return { proxy: werte };
  }

  /**
   * Die innere Nummer eines Proxys. Sie bleibt, wenn sich die Kennung aendert,
   * und taugt deshalb als Schluessel fuer Item-IDs und Puffer.
   */
  idVon(kennung: string): number | null {
    const zeile = this.#db.prepare("SELECT id FROM proxys WHERE kennung = ?").get(kennung) as { id: number } | undefined;
    return zeile?.id ?? null;
  }

  /** Die Item-IDs eines Proxys in gespeicherter Reihenfolge, null wenn es ihn nicht gibt. */
  itemIds(kennung: string): string[] | null {
    const id = this.idVon(kennung);
    if (id === null) return null;
    const zeilen = this.#db
      .prepare("SELECT itemId FROM items WHERE proxyId = ? ORDER BY position ASC")
      .all(id) as { itemId: string }[];
    return zeilen.map((zeile) => zeile.itemId);
  }

  /**
   * Ersetzt die ganze Liste. Leerraum am Rand faellt weg, leere Zeilen und
   * Doppelte ebenso, bei Doppelten gilt die erste Stelle.
   */
  itemIdsSetzen(kennung: string, roh: unknown): { itemIds: string[] } | { fehler: string } | null {
    const id = this.idVon(kennung);
    if (id === null) return null;
    if (!Array.isArray(roh) || roh.some((eintrag) => typeof eintrag !== "string")) {
      return { fehler: "itemIds muss eine Liste von Zeichenketten sein." };
    }
    const liste: string[] = [];
    const gesehen = new Set<string>();
    for (const eintrag of roh as string[]) {
      const sauber = eintrag.trim();
      if (sauber === "" || gesehen.has(sauber)) continue;
      if (sauber.length > ITEM_LAENGE_MAX) {
        return { fehler: `Eine Item-ID darf höchstens ${ITEM_LAENGE_MAX} Zeichen haben.` };
      }
      gesehen.add(sauber);
      liste.push(sauber);
    }
    if (liste.length > ITEMS_MAX) return { fehler: `Höchstens ${ITEMS_MAX} Item-IDs je Proxy.` };

    const einfuegen = this.#db.prepare("INSERT INTO items (proxyId, itemId, position) VALUES (?, ?, ?)");
    this.#db.transaction(() => {
      this.#db.prepare("DELETE FROM items WHERE proxyId = ?").run(id);
      liste.forEach((itemId, position) => einfuegen.run(id, itemId, position));
    })();
    return { itemIds: liste };
  }

  /** Jeder laesst sich loeschen, auch der letzte. Keiner hat einen Sonderplatz. */
  loeschen(kennung: string): { fehler: string } | null {
    if (this.nachKennung(kennung) === null) return { fehler: "Diesen Proxy gibt es nicht." };
    this.#db.prepare("DELETE FROM proxys WHERE kennung = ?").run(kennung);
    return null;
  }
}
