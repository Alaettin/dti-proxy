import path from "node:path";
import { createRequire } from "node:module";
import express, { Router, type Request, type Response } from "express";
import { basisUrl, zustaendigFuer } from "../aufloesung.js";
import type { Einstellungen } from "../einstellungen.js";
import type { SpecQuelle } from "../openapi.js";
import type { Proxy, Proxys } from "../proxys.js";

const erfordern = createRequire(import.meta.url);
const uiVerzeichnis = path.dirname(erfordern.resolve("swagger-ui-dist/package.json"));

/** Die Dateien der Swagger-Oberflaeche liegen einmal hier, fuer alle Proxys. */
export const UI_PFAD = "/swagger-ui";
export const SPEC_REST = "/swagger/aas/swagger.json";
export const SEITE_REST = "/swagger/index.html";

/** Die oeffentliche Basis des Dienstes, notfalls aus der Anfrage abgeleitet. */
export function dienstBasisAus(req: Request, einstellungen: Einstellungen): string {
  const gesetzt = einstellungen.lesen("proxyBasis");
  if (gesetzt !== "") return gesetzt;
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

export function proxyBasisAus(req: Request, einstellungen: Einstellungen, proxy: Proxy): string {
  return basisUrl(dienstBasisAus(req, einstellungen), proxy);
}

function seite(specPfad: string, titel: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${titel}</title>
<link rel="stylesheet" href="${UI_PFAD}/swagger-ui.css" />
<style>body{margin:0}.topbar{display:none}</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="${UI_PFAD}/swagger-ui-bundle.js" charset="utf-8"></script>
<script src="${UI_PFAD}/swagger-ui-standalone-preset.js" charset="utf-8"></script>
<script>
window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: ${JSON.stringify(specPfad)},
    dom_id: "#swagger-ui",
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: "StandaloneLayout",
    deepLinking: true,
    docExpansion: "list",
    tryItOutEnabled: true,
    validatorUrl: null
  });
};
</script>
</body>
</html>`;
}

export function swaggerRouter(einstellungen: Einstellungen, proxys: Proxys, quelle: SpecQuelle): Router {
  const router = Router();

  // Ein Zugriff auf die Dateien der Oberflaeche, nicht je Proxy einer.
  router.use(UI_PFAD, express.static(uiVerzeichnis, { index: false }));

  router.use(async (req: Request, res: Response, next) => {
    if (req.method !== "GET") return next();
    const zustaendig = zustaendigFuer(req.originalUrl, proxys);
    if (zustaendig === null) return next();
    const { proxy, basisPfad, rest } = zustaendig;
    const ohneQuery = rest.split("?")[0] ?? "";

    if (ohneQuery === SPEC_REST) {
      const { dokument, quelle: herkunft } = await quelle.dokument(
        proxy.upstreamBasis,
        proxy.zeitlimitMs,
        proxyBasisAus(req, einstellungen, proxy),
      );
      res.setHeader("x-spec-quelle", herkunft);
      res.json(dokument);
      return;
    }

    if (ohneQuery === SEITE_REST) {
      res.type("html").send(seite(basisPfad + SPEC_REST, `DTI Proxy API: ${proxy.name}`));
      return;
    }

    // Kurzform: /swagger und der blanke Proxy-Weg fuehren auf die Seite.
    if (ohneQuery === "/swagger" || (zustaendig.benannt && (ohneQuery === "" || ohneQuery === "/"))) {
      res.redirect(302, basisPfad + SEITE_REST);
      return;
    }

    next();
  });

  return router;
}
