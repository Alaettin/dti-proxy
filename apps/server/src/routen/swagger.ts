import path from "node:path";
import { createRequire } from "node:module";
import express, { Router, type Request } from "express";
import type { Einstellungen } from "../einstellungen.js";
import type { SpecQuelle } from "../openapi.js";

const erfordern = createRequire(import.meta.url);
const uiVerzeichnis = path.dirname(erfordern.resolve("swagger-ui-dist/package.json"));

export const SPEC_PFAD = "/swagger/aas/swagger.json";

/** Die oeffentliche Basis dieses Proxys, notfalls aus der Anfrage abgeleitet. */
export function proxyBasisAus(req: Request, einstellungen: Einstellungen): string {
  const gesetzt = einstellungen.lesen("proxyBasis");
  if (gesetzt !== "") return gesetzt;
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

const SEITE = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DTI Proxy API</title>
<link rel="stylesheet" href="./swagger-ui.css" />
<style>body{margin:0}.topbar{display:none}</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="./swagger-ui-bundle.js" charset="utf-8"></script>
<script src="./swagger-ui-standalone-preset.js" charset="utf-8"></script>
<script>
window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: "${SPEC_PFAD}",
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

export function swaggerRouter(einstellungen: Einstellungen, quelle: SpecQuelle): Router {
  const router = Router();

  router.get(SPEC_PFAD, async (req, res) => {
    const { dokument, quelle: herkunft } = await quelle.dokument(proxyBasisAus(req, einstellungen));
    res.setHeader("x-spec-quelle", herkunft);
    res.json(dokument);
  });

  router.get("/swagger", (_req, res) => {
    res.redirect(302, "/swagger/index.html");
  });

  router.get("/swagger/index.html", (_req, res) => {
    res.type("html").send(SEITE);
  });

  // Nach den eigenen Routen, damit die eigene index.html gewinnt.
  router.use("/swagger", express.static(uiVerzeichnis, { index: false }));

  return router;
}
