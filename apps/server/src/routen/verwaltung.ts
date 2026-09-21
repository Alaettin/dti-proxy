import { Router, type NextFunction, type Request, type Response } from "express";
import { basisUrl } from "../aufloesung.js";
import type { Einstellungen, Schluessel } from "../einstellungen.js";
import { VORGABEN } from "../einstellungen.js";
import type { Proxy, Proxys } from "../proxys.js";
import { kennungAus } from "../proxys.js";
import { gleich, sitzungLoeschen, sitzungPruefen, sitzungSetzen } from "../sitzung.js";
import { dienstBasisAus } from "./swagger.js";

const VERSUCHE_MAX = 5;
const SPERRE_MS = 15 * 60 * 1000;

/** Express 5 tippt einen Wegparameter als string oder string[]. */
function wegKennung(req: Request): string {
  const roh = req.params.kennung;
  return Array.isArray(roh) ? (roh[0] ?? "") : (roh ?? "");
}

export interface VerwaltungOptionen {
  einstellungen: Einstellungen;
  proxys: Proxys;
  holen?: typeof fetch;
  benutzer: string;
  passwort: string;
  geheimnis: string;
  /**
   * Erzwingt das Secure-Merkmal am Cookie. Ohne Angabe entscheidet die
   * tatsaechliche Verbindung (req.secure, hinter einem Proxy aus
   * X-Forwarded-Proto). Ein Secure-Cookie ueber reines HTTP wird vom Browser
   * verworfen, dann kann sich niemand anmelden.
   */
  sicher?: boolean;
}

export function verwaltungRouter({
  einstellungen,
  proxys,
  holen = fetch,
  benutzer,
  passwort,
  geheimnis,
  sicher,
}: VerwaltungOptionen): Router {
  const router = Router();
  const versuche = new Map<string, { zahl: number; sperreBis: number }>();

  function schutz(req: Request, res: Response, next: NextFunction): void {
    if (sitzungPruefen(req, geheimnis) === null) {
      res.status(401).json({ fehler: "Nicht angemeldet." });
      return;
    }
    next();
  }

  /** Was die Oberflaeche je Proxy braucht, inklusive der fertigen Basis-URL. */
  function anzeigen(req: Request, proxy: Proxy): Proxy & { basisUrl: string; basisPfad: string } {
    return {
      ...proxy,
      basisUrl: basisUrl(dienstBasisAus(req, einstellungen), proxy),
      basisPfad: proxy.standard ? "" : `/p/${proxy.kennung}`,
    };
  }

  router.post("/anmelden", (req, res) => {
    const herkunft = req.ip ?? "unbekannt";
    const stand = versuche.get(herkunft);
    if (stand && stand.sperreBis > Date.now()) {
      const sekunden = Math.ceil((stand.sperreBis - Date.now()) / 1000);
      res.status(429).json({ fehler: `Zu viele Versuche. Neuer Versuch in ${sekunden} Sekunden.` });
      return;
    }

    const eingabe = req.body as { benutzer?: unknown; passwort?: unknown } | undefined;
    const passt =
      typeof eingabe?.benutzer === "string" &&
      typeof eingabe.passwort === "string" &&
      gleich(eingabe.benutzer, benutzer) &&
      gleich(eingabe.passwort, passwort);

    if (!passt) {
      const zahl = (stand?.zahl ?? 0) + 1;
      versuche.set(herkunft, { zahl, sperreBis: zahl >= VERSUCHE_MAX ? Date.now() + SPERRE_MS : 0 });
      res.status(401).json({ fehler: "Benutzername oder Passwort stimmt nicht." });
      return;
    }

    versuche.delete(herkunft);
    sitzungSetzen(res, benutzer, geheimnis, sicher ?? req.secure);
    res.json({ angemeldet: true, benutzer });
  });

  router.post("/abmelden", (_req, res) => {
    sitzungLoeschen(res);
    res.json({ angemeldet: false });
  });

  router.get("/sitzung", (req, res) => {
    const angemeldeter = sitzungPruefen(req, geheimnis);
    res.json({ angemeldet: angemeldeter !== null, benutzer: angemeldeter });
  });

  // Allgemeines, also das, was fuer alle Proxys zugleich gilt.

  router.get("/einstellungen", schutz, (req, res) => {
    res.json({
      werte: einstellungen.alle(),
      vorgaben: VORGABEN,
      dienstBasis: dienstBasisAus(req, einstellungen),
    });
  });

  router.put("/einstellungen", schutz, (req, res) => {
    const eingabe = req.body as Partial<Record<Schluessel, string>> | undefined;
    if (typeof eingabe !== "object" || eingabe === null || Array.isArray(eingabe)) {
      res.status(400).json({ fehler: "Es wird ein Objekt mit Einstellungen erwartet." });
      return;
    }
    const verstoesse = einstellungen.schreiben(eingabe);
    if (verstoesse.length > 0) {
      res.status(400).json({ fehler: "Die Eingabe ist nicht gültig.", verstoesse });
      return;
    }
    res.json({ werte: einstellungen.alle(), dienstBasis: dienstBasisAus(req, einstellungen) });
  });

  // Die Proxys selbst.

  router.get("/proxys", schutz, (req, res) => {
    res.json({ proxys: proxys.alle().map((proxy) => anzeigen(req, proxy)) });
  });

  router.post("/proxys", schutz, (req, res) => {
    const eingabe = (req.body ?? {}) as { name?: string; kennung?: string };
    // Ohne eigene Kennung eine aus dem Namen ableiten, das ist der Normalfall.
    const gegeben = typeof eingabe.kennung === "string" ? eingabe.kennung.trim() : "";
    const kennung = gegeben !== "" ? gegeben : kennungAus(eingabe.name ?? "");
    const ergebnis = proxys.anlegen({ ...eingabe, kennung });
    if ("verstoesse" in ergebnis) {
      res.status(400).json({ fehler: "Die Eingabe ist nicht gültig.", verstoesse: ergebnis.verstoesse });
      return;
    }
    res.status(201).json({ proxy: anzeigen(req, ergebnis.proxy) });
  });

  router.put("/proxys/:kennung", schutz, (req, res) => {
    const ergebnis = proxys.aendern(wegKennung(req), (req.body ?? {}) as Record<string, string>);
    if (ergebnis === null) {
      res.status(404).json({ fehler: "Diesen Proxy gibt es nicht." });
      return;
    }
    if ("verstoesse" in ergebnis) {
      res.status(400).json({ fehler: "Die Eingabe ist nicht gültig.", verstoesse: ergebnis.verstoesse });
      return;
    }
    res.json({ proxy: anzeigen(req, ergebnis.proxy) });
  });

  router.delete("/proxys/:kennung", schutz, (req, res) => {
    const fehler = proxys.loeschen(wegKennung(req));
    if (fehler !== null) {
      res.status(400).json(fehler);
      return;
    }
    res.json({ proxys: proxys.alle().map((proxy) => anzeigen(req, proxy)) });
  });

  router.post("/proxys/:kennung/standard", schutz, (req, res) => {
    const fehler = proxys.standardSetzen(wegKennung(req));
    if (fehler !== null) {
      res.status(400).json(fehler);
      return;
    }
    res.json({ proxys: proxys.alle().map((proxy) => anzeigen(req, proxy)) });
  });

  /** Fragt /description beim Zielsystem eines Proxys ab und zeigt, was zurueckkommt. */
  router.post("/proxys/:kennung/pruefung", schutz, async (req, res) => {
    const proxy = proxys.nachKennung(wegKennung(req));
    if (proxy === null) {
      res.status(404).json({ fehler: "Diesen Proxy gibt es nicht." });
      return;
    }
    try {
      const antwort = await holen(`${proxy.upstreamBasis}/description`, {
        signal: AbortSignal.timeout(proxy.zeitlimitMs),
      });
      const text = await antwort.text();
      res.json({ erreichbar: antwort.ok, status: antwort.status, koerper: text.slice(0, 2000) });
    } catch (fehler) {
      res.json({ erreichbar: false, status: 0, fehler: fehler instanceof Error ? fehler.message : String(fehler) });
    }
  });

  return router;
}
