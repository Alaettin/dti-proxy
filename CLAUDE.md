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

`upstreamBasis`, `aasBasis`, `zeitlimitMs`, `pufferStunden` und die drei Schalter (`SCHALTER` in `proxys.ts`) gehören je Proxy in die Tabelle. In
`einstellungen` steht nur noch `proxyBasis`, die öffentliche Basis des Dienstes.

## GET /shells

Die Zielsysteme kennen `GET /shells` nicht, der Proxy bedient ihn selbst: Liste aus der Tabelle
`items` (Item-IDs je Proxy), jede Schale einzeln oben über `GET /shells/{id}`.

`GET /shells` ist je Proxy schaltbar (`shellsAktiv`, ab Werk aus). Ausgeschaltet ruft der Handler
`next()`, der Weg gibt das gewohnte 404, und die Swagger-Seite führt `/shells` nicht.

## Puffer und Erneuerung

`/shells` und beide Registries lesen aus **einem** Bestand je Proxy (`puffer.ts`), gepuffert je
Schale (200 und 404), Schlüssel mit Hash von `Authorization`. Der Bestand verfällt nicht je
Eintrag, sondern wird als Ganzes im Hintergrund erneuert (`erneuerung.ts`): alle `pufferStunden`,
beim Start, nach Änderungen an Item-IDs, Basen, Dauer oder Schaltern und auf Knopfdruck. Getauscht
wird erst am Ende; scheitert ein Abruf, bleibt der alte Eintrag. Der Takt prüft jede Minute, kein
`setTimeout` über die volle Dauer (720 h liegen über dessen Grenze). Die zehn durchgereichten Pfade
bleiben ungepuffert.

## Registry

`GET /shell-descriptors` und `GET /shell-descriptors/{aasIdentifier}` nach AAS Registry SSP-002.
Registriert ist, was in `items` steht; die Descriptoren entstehen aus den Schalen von oben, über
denselben Puffer. `id` ist die Kennung, die die Schale selbst meldet, die Endpunkte zeigen auf den
Proxy (`/shells/…`, `/submodels/…`). Eigener Schalter `registryAktiv`, ab Werk aus. Der
Schemaauszug `spec/registry-schemas.json` stammt aus den IDTA-Part2-Schemas v3.1.3 und prüft die
Ausgabe im Test; nicht von Hand ändern, sondern neu ziehen.

## Submodel Registry

`GET /submodel-descriptors` und `GET /submodel-descriptors/{submodelIdentifier}` nach Submodel
Registry SSP-002. Registriert sind die Teilmodelle, auf die die Schalen der Item-IDs verweisen;
die Descriptoren entstehen allein aus diesen Verweisen (`teilmodellDescriptoren` in `registry.ts`),
kein Aufruf je Teilmodell oben. Doppelte nur einmal. Eigener Schalter `submodelRegistryAktiv`.

## Aufbau

* `apps/server/src/pfade.ts` die Freigabeliste der zehn Pfade, bewacht von einem Abgleichtest
  gegen `spec/aas.swagger.json`
* `apps/server/src/aufloesung.ts` welcher Proxy zuständig ist und was vom Pfad übrig bleibt
* `apps/server/src/proxys.ts` Anlegen, Ändern, Löschen, Item-IDs
* `apps/server/src/db.ts` Tabellen und die Wanderung vom alten Ein-Proxy-Stand
* `apps/server/src/routen/weiterleitung.ts` das Durchreichen
* `apps/server/src/routen/discovery.ts` die neue Operation, rechnet nur, fragt nie oben
* `apps/server/src/routen/shells.ts` GET /shells aus den Item-IDs
* `apps/server/src/routen/registry.ts` die Registry, `descriptorAus` baut den Descriptor aus der Schale
* `apps/server/src/routen/submodelRegistry.ts` die Submodel Registry
* `apps/server/src/schalen.ts` Schalen einzeln oben holen, gedrosselt und gepuffert, für alle drei
* `apps/server/src/puffer.ts` der Bestand je Proxy, `erneuern` tauscht ihn als Ganzes
* `apps/server/src/erneuerung.ts` Takt und Anstoß der Erneuerung; `index.ts` startet ihn
* `apps/server/src/paging.ts` limit und cursor, geteilt von allen eigenen Wegen
* `apps/server/src/openapi.ts` holt die Spec von oben und hängt die eigenen Wege an, je Zielsystem
* `apps/web/src/aufrufe.ts` der Katalog der sechzehn Aufrufe und der Adressbau, getrennt geprüft
* `apps/web` React-Oberfläche unter `/admin`

## Beim Arbeiten

* Tests vor "fertig": `npm test` im Wurzelverzeichnis.
* Ändert sich die Spec oben, fällt der Abgleichtest in `test/pfade.test.ts` um. Dann `spec/aas.swagger.json`
  neu ziehen und `AAS_PFADE` nachziehen, nicht den Test aufweichen.
* `better-sqlite3` ist nativ und bleibt in `build.mjs` unter `external`.
* Nicht pushen ohne ausdrückliche Ansage.
