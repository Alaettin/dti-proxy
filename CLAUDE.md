# DTI Proxy

Projektakte in Outline: `01 Projekte > 02 Arbeit > 10 DTI Proxy`. Erst die Akte lesen, nicht aus
dem Code rekonstruieren, was dort steht.

## Die eine Regel

Die zehn AAS-Pfade werden **unverändert** durchgereicht. Kein Umschreiben von Pfaden, kein
Ergänzen oder Entfernen von Kopfzeilen außer den Hop-by-Hop-Feldern, kein eigener Statuscode
außer 502 bei Ausfall und 405 bei falscher Methode. Wer hier etwas "verbessern" will, bricht den
Zweck des Projekts.

Konkret: `src/routen/weiterleitung.ts` arbeitet mit `req.originalUrl`. Niemals auf `req.path`,
`req.params` oder eine Express-Parameterroute umstellen, das dekodiert base64url-IDs und ein
`%2F` im `idShortPath`. Der Test "reicht den rohen Pfad zeichengenau nach oben" bewacht das.

## Aufbau

* `apps/server/src/pfade.ts` die Freigabeliste der zehn Pfade, bewacht von einem Abgleichtest
  gegen `spec/aas.swagger.json`
* `apps/server/src/routen/weiterleitung.ts` das Durchreichen
* `apps/server/src/routen/discovery.ts` die neue Operation, rechnet nur, fragt nie oben
* `apps/server/src/openapi.ts` holt die Spec von oben und hängt Discovery an
* `apps/web` React-Oberfläche unter `/admin`

## Beim Arbeiten

* Tests vor "fertig": `npm test` im Wurzelverzeichnis.
* Ändert sich die Spec oben, fällt der Abgleichtest in `test/pfade.test.ts` um. Dann `spec/aas.swagger.json`
  neu ziehen und `AAS_PFADE` nachziehen, nicht den Test aufweichen.
* `better-sqlite3` ist nativ und bleibt in `build.mjs` unter `external`.
* Nicht pushen ohne ausdrückliche Ansage.
