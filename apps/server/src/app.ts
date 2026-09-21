import fs from "node:fs";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Einstellungen } from "./einstellungen.js";
import { ergebnis, type Uhr, echteUhr } from "./fehler.js";
import { konfiguration } from "./konfiguration.js";
import { SpecQuelle } from "./openapi.js";
import type { Proxys } from "./proxys.js";
import { discovery, istDiscovery } from "./routen/discovery.js";
import { swaggerRouter } from "./routen/swagger.js";
import { verwaltungRouter } from "./routen/verwaltung.js";
import { weiterleitung } from "./routen/weiterleitung.js";

export interface AppOptionen {
  einstellungen: Einstellungen;
  proxys: Proxys;
  holen?: typeof fetch;
  uhr?: Uhr;
  benutzer?: string;
  passwort?: string;
  geheimnis?: string;
  /** Ohne Angabe entscheidet die tatsaechliche Verbindung ueber das Secure-Merkmal. */
  sicher?: boolean;
  webVerzeichnis?: string | null;
}

export function appAnlegen({
  einstellungen,
  proxys,
  holen = fetch,
  uhr = echteUhr,
  benutzer = konfiguration.adminBenutzer,
  passwort = konfiguration.adminPasswort,
  geheimnis = konfiguration.sitzungsGeheimnis,
  sicher,
  webVerzeichnis = konfiguration.webVerzeichnis,
}: AppOptionen): Express {
  const app = express();
  app.disable("x-powered-by");
  // Ohne das haengt Express einen eigenen ETag an durchgereichte Antworten.
  app.set("etag", false);
  // Hinter Caddy oder Sliplane steht das echte Schema in X-Forwarded-Proto.
  app.set("trust proxy", true);

  const quelle = new SpecQuelle(holen);

  app.get("/gesundheit", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Ganz vorn und vor jedem Body-Parser: die Weiterleitung soll die Anfrage
  // sehen, wie sie hereinkam.
  app.use(weiterleitung({ proxys, holen, uhr }));

  // Der Body-Parser laeuft nur auf dem Discovery-Weg. Alles andere bleibt roh.
  const koerperLesen = express.json({ limit: "1mb", type: () => true });
  app.use((req, res, next) => {
    if (req.method === "POST" && istDiscovery(req.originalUrl, proxys)) return koerperLesen(req, res, next);
    next();
  });
  app.use(discovery({ proxys, uhr }));

  app.use(swaggerRouter(einstellungen, proxys, quelle));

  app.use(
    "/admin/api",
    express.json({ limit: "64kb" }),
    verwaltungRouter({ einstellungen, proxys, holen, benutzer, passwort, geheimnis, sicher }),
  );

  if (webVerzeichnis !== null && fs.existsSync(webVerzeichnis)) {
    app.use("/admin", express.static(webVerzeichnis, { index: "index.html" }));
    // Die Oberflaeche traegt ihre eigenen Wege, jeder unbekannte /admin-Weg
    // gehoert an ihre index.html. Ausgenommen /admin/api: ein unbekannter
    // Weg dort ist ein Fehler und darf nicht als HTML-Seite zurueckkommen.
    app.get(/^\/admin(?!\/api(?:\/|$))(?:\/.*)?$/, (_req, res) => {
      res.sendFile(path.join(webVerzeichnis, "index.html"));
    });
  }

  app.get("/", (_req, res) => {
    res.redirect(302, "/admin/");
  });

  // Kaputtes JSON darf nicht als HTML-Fehlerseite zurueckkommen.
  app.use((fehler: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(fehler);
    const typ = (fehler as { type?: string } | null)?.type;
    if (typ === "entity.parse.failed") {
      res.status(400).json(ergebnis("400", "The request body is not valid JSON.", "Error", uhr));
      return;
    }
    if (typ === "entity.too.large") {
      res.status(413).json(ergebnis("413", "The request body is too large.", "Error", uhr));
      return;
    }
    res.status(500).json(ergebnis("500", "Internal proxy error.", "Error", uhr));
  });

  app.use((req: Request, res: Response) => {
    res.status(404).json(ergebnis("404", `No route for ${req.method} ${req.path} on this proxy.`, "Error", uhr));
  });

  return app;
}
