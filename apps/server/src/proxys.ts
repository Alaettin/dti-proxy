import type { Datenbank } from "./db.js";
import { PROXY_VORGABEN } from "./db.js";
import { basisPruefen } from "./einstellungen.js";

export type ProxyFeld = "kennung" | "name" | "upstreamBasis" | "aasBasis" | "zeitlimitMs";

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
  angelegtAm: string;
}

export interface ProxyEingabe {
  kennung?: string;
  name?: string;
  upstreamBasis?: string;
  aasBasis?: string;
  zeitlimitMs?: string | number;
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

const SPALTEN = "kennung, name, upstreamBasis, aasBasis, zeitlimitMs, angelegtAm";

export class Proxys {
  #db: Datenbank;

  constructor(db: Datenbank) {
    this.#db = db;
  }

  alle(): Proxy[] {
    return this.#db.prepare(`SELECT ${SPALTEN} FROM proxys ORDER BY angelegtAm ASC, id ASC`).all() as Proxy[];
  }

  nachKennung(kennung: string): Proxy | null {
    const zeile = this.#db.prepare(`SELECT ${SPALTEN} FROM proxys WHERE kennung = ?`).get(kennung) as
      | Proxy
      | undefined;
    return zeile ?? null;
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
        `INSERT INTO proxys (kennung, name, upstreamBasis, aasBasis, zeitlimitMs, angelegtAm)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(werte.kennung, werte.name, werte.upstreamBasis, werte.aasBasis, werte.zeitlimitMs, werte.angelegtAm);
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
        `UPDATE proxys SET kennung = ?, name = ?, upstreamBasis = ?, aasBasis = ?, zeitlimitMs = ?
         WHERE kennung = ?`,
      )
      .run(werte.kennung, werte.name, werte.upstreamBasis, werte.aasBasis, werte.zeitlimitMs, kennung);
    return { proxy: werte };
  }

  /** Jeder laesst sich loeschen, auch der letzte. Keiner hat einen Sonderplatz. */
  loeschen(kennung: string): { fehler: string } | null {
    if (this.nachKennung(kennung) === null) return { fehler: "Diesen Proxy gibt es nicht." };
    this.#db.prepare("DELETE FROM proxys WHERE kennung = ?").run(kennung);
    return null;
  }
}
