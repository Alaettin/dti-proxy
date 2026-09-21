import { Router, type NextFunction, type Request, type Response } from "express";
import type { Einstellungen, Schluessel } from "../einstellungen.js";
import { VORGABEN } from "../einstellungen.js";
import type { SpecQuelle } from "../openapi.js";
import { gleich, sitzungLoeschen, sitzungPruefen, sitzungSetzen } from "../sitzung.js";
import { proxyBasisAus } from "./swagger.js";

const VERSUCHE_MAX = 5;
const SPERRE_MS = 15 * 60 * 1000;

export interface VerwaltungOptionen {
  einstellungen: Einstellungen;
  quelle: SpecQuelle;
  holen?: typeof fetch;
  benutzer: string;
  passwort: string;
  geheimnis: string;
  sicher: boolean;
}

export function verwaltungRouter({
  einstellungen,
  quelle,
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
    sitzungSetzen(res, benutzer, geheimnis, sicher);
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

  router.get("/einstellungen", schutz, (req, res) => {
    res.json({ werte: einstellungen.alle(), vorgaben: VORGABEN, proxyBasisEffektiv: proxyBasisAus(req, einstellungen) });
  });

  router.put("/einstellungen", schutz, (req, res) => {
    const eingabe = req.body as Partial<Record<Schluessel, string>> | undefined;
    if (typeof eingabe !== "object" || eingabe === null || Array.isArray(eingabe)) {
      res.status(400).json({ fehler: "Es wird ein Objekt mit Einstellungen erwartet." });
      return;
    }
    const verstoesse = einstellungen.schreiben(eingabe);
    if (verstoesse.length > 0) {
      res.status(400).json({ fehler: "Die Eingabe ist nicht gueltig.", verstoesse });
      return;
    }
    res.json({ werte: einstellungen.alle(), proxyBasisEffektiv: proxyBasisAus(req, einstellungen) });
  });

  /** Fragt /description beim Zielsystem ab und zeigt, was zurueckkommt. */
  router.post("/pruefung", schutz, async (_req, res) => {
    const basis = einstellungen.lesen("upstreamBasis");
    try {
      const antwort = await holen(`${basis}/description`, {
        signal: AbortSignal.timeout(einstellungen.zeitlimit()),
      });
      const text = await antwort.text();
      res.json({ erreichbar: antwort.ok, status: antwort.status, koerper: text.slice(0, 2000) });
    } catch (fehler) {
      res.json({ erreichbar: false, status: 0, fehler: fehler instanceof Error ? fehler.message : String(fehler) });
    }
  });

  /** Sagt, ob die Swagger-Spec gerade von oben oder aus der Kopie kommt. */
  router.get("/spec-herkunft", schutz, async (req, res) => {
    const { quelle: herkunft, dokument } = await quelle.dokument(proxyBasisAus(req, einstellungen));
    res.json({ herkunft, pfade: Object.keys(dokument.paths).length });
  });

  return router;
}
