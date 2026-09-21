import type { Datenbank } from "./db.js";

export const VORGABEN = {
  /** Basis der alten Funktionen, also das Zielsystem der Weiterleitung. */
  upstreamBasis: "https://rc.test.dti.neoception.dev",
  /** Oeffentliche Basis dieses Proxys. Leer bedeutet: aus der Anfrage ableiten. */
  proxyBasis: "",
  /** Schema und Domain fuer die gebauten AAS-IDs, der Punkt "Sonstiges". */
  aasBasis: "https://viewer-pf.test.dti.neoception.dev",
  /** Zeitlimit der Weiterleitung in Millisekunden. */
  zeitlimitMs: "30000",
} as const;

export type Schluessel = keyof typeof VORGABEN;
export type Werte = Record<Schluessel, string>;

export interface Pruefverstoss {
  feld: Schluessel;
  text: string;
}

const SCHLUESSEL = Object.keys(VORGABEN) as Schluessel[];

/**
 * Basis-URLs werden auf Form geprueft, aber private Adressbereiche werden
 * bewusst nicht gesperrt: das Feld liegt hinter dem Login, und ein Ziel auf
 * 127.0.0.1 ist beim lokalen Testen der Normalfall.
 */
export function basisPruefen(feld: Schluessel, roh: string): { wert: string } | { text: string } {
  const wert = roh.trim();
  if (wert === "") return { text: `${feld} darf nicht leer sein.` };
  let url: URL;
  try {
    url = new URL(wert);
  } catch {
    return { text: `${feld} ist keine gueltige URL.` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { text: `${feld} muss mit http:// oder https:// beginnen.` };
  }
  if (url.search !== "" || url.hash !== "") {
    return { text: `${feld} darf keinen Query-Teil und keinen Anker enthalten.` };
  }
  // Ein abschliessender Schraegstrich wuerde beim Zusammensetzen mit dem rohen
  // Pfad ein doppeltes // ergeben, und das waere bereits eine Veraenderung.
  const ohneSchraegstrich = (url.origin + url.pathname).replace(/\/+$/, "");
  return { wert: ohneSchraegstrich };
}

function zeitlimitPruefen(roh: string): { wert: string } | { text: string } {
  const zahl = Number(roh);
  if (!Number.isInteger(zahl) || zahl < 1000 || zahl > 300_000) {
    return { text: "zeitlimitMs muss eine ganze Zahl zwischen 1000 und 300000 sein." };
  }
  return { wert: String(zahl) };
}

export class Einstellungen {
  #db: Datenbank;

  constructor(db: Datenbank) {
    this.#db = db;
  }

  alle(): Werte {
    const zeilen = this.#db.prepare("SELECT schluessel, wert FROM einstellungen").all() as {
      schluessel: string;
      wert: string;
    }[];
    const gespeichert = new Map(zeilen.map((z) => [z.schluessel, z.wert]));
    const ergebnis = {} as Werte;
    for (const schluessel of SCHLUESSEL) {
      ergebnis[schluessel] = gespeichert.get(schluessel) ?? VORGABEN[schluessel];
    }
    return ergebnis;
  }

  lesen(schluessel: Schluessel): string {
    const zeile = this.#db
      .prepare("SELECT wert FROM einstellungen WHERE schluessel = ?")
      .get(schluessel) as { wert: string } | undefined;
    return zeile?.wert ?? VORGABEN[schluessel];
  }

  zeitlimit(): number {
    return Number(this.lesen("zeitlimitMs"));
  }

  /** Prueft und schreibt. Bei Verstoessen wird nichts geschrieben. */
  schreiben(eingabe: Partial<Record<Schluessel, string>>): Pruefverstoss[] {
    const verstoesse: Pruefverstoss[] = [];
    const sauber: Partial<Record<Schluessel, string>> = {};

    for (const [feld, roh] of Object.entries(eingabe) as [Schluessel, string][]) {
      if (!SCHLUESSEL.includes(feld)) {
        verstoesse.push({ feld, text: `${feld} ist keine bekannte Einstellung.` });
        continue;
      }
      if (feld === "zeitlimitMs") {
        const geprueft = zeitlimitPruefen(roh);
        if ("text" in geprueft) verstoesse.push({ feld, text: geprueft.text });
        else sauber[feld] = geprueft.wert;
        continue;
      }
      if (feld === "proxyBasis" && roh.trim() === "") {
        sauber[feld] = "";
        continue;
      }
      const geprueft = basisPruefen(feld, roh);
      if ("text" in geprueft) verstoesse.push({ feld, text: geprueft.text });
      else sauber[feld] = geprueft.wert;
    }

    if (verstoesse.length > 0) return verstoesse;

    const setzen = this.#db.prepare(
      "INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert",
    );
    this.#db.transaction(() => {
      for (const [feld, wert] of Object.entries(sauber) as [Schluessel, string][]) {
        setzen.run(feld, wert);
      }
    })();
    return [];
  }
}
