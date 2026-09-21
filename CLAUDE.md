# DTI Proxy

Projektakte in Outline: `01 Projekte > 02 Arbeit > 10 DTI Proxy`. Erst die Akte lesen, nicht aus
dem Code rekonstruieren, was dort steht.

## Die eine Regel

Die zehn AAS-Pfade werden **unverändert** durchgereicht. Kein Umschreiben von Pfaden, kein
Ergänzen oder Entfernen von Kopfzeilen außer den Hop-by-Hop-Feldern, kein eigener Statuscode
außer 502 bei Ausfall und 405 bei falscher Methode. Wer hier etwas "verbessern" will, bricht den
Zweck des Projekts.

Konkret: `src/routen/weiterleitung.ts` und `src/aufloesung.ts` arbeiten mit `req.originalUrl`
und schneiden das Präfix per `slice` ab. Niemals auf `req.path`, `req.params` oder eine
Express-Parameterroute umstellen, das dekodiert base64url-IDs und ein `%2F` im `idShortPath`.
Die Tests "reicht den rohen Pfad zeichengenau nach oben" und "schneidet den Rest hinter
/p/<kennung> zeichengenau ab" bewachen das.

## Mehrere Proxys

Ein Dienst trägt mehrere Proxys, Tabelle `proxys`. Jeder liegt unter `/p/<kennung>`, alle sind
gleichberechtigt. **Keinen Standard wieder einführen**, und nichts an die Wurzel legen: das war
schon einmal da und hat nur Sonderfälle erzeugt.

Die Kennung steht in der Adresse und darf sich beim Umbenennen nicht ändern, sonst bricht sie
den Aufrufern weg. Sie wird nur abgeleitet, wenn beim Anlegen keine angegeben ist.

`upstreamBasis`, `aasBasis` und `zeitlimitMs` gehören je Proxy in die Tabelle. In
`einstellungen` steht nur noch `proxyBasis`, die öffentliche Basis des Dienstes.

## Aufbau

* `apps/server/src/pfade.ts` die Freigabeliste der zehn Pfade, bewacht von einem Abgleichtest
  gegen `spec/aas.swagger.json`
* `apps/server/src/aufloesung.ts` welcher Proxy zuständig ist und was vom Pfad übrig bleibt
* `apps/server/src/proxys.ts` Anlegen, Ändern, Löschen, Standard
* `apps/server/src/db.ts` Tabellen und die Wanderung vom alten Ein-Proxy-Stand
* `apps/server/src/routen/weiterleitung.ts` das Durchreichen
* `apps/server/src/routen/discovery.ts` die neue Operation, rechnet nur, fragt nie oben
* `apps/server/src/openapi.ts` holt die Spec von oben und hängt Discovery an, je Zielsystem
* `apps/web/src/aufrufe.ts` der Katalog der elf Aufrufe und der Adressbau, getrennt geprüft
* `apps/web` React-Oberfläche unter `/admin`

## Beim Arbeiten

* Tests vor "fertig": `npm test` im Wurzelverzeichnis.
* Ändert sich die Spec oben, fällt der Abgleichtest in `test/pfade.test.ts` um. Dann `spec/aas.swagger.json`
  neu ziehen und `AAS_PFADE` nachziehen, nicht den Test aufweichen.
* `better-sqlite3` ist nativ und bleibt in `build.mjs` unter `external`.
* Nicht pushen ohne ausdrückliche Ansage.
