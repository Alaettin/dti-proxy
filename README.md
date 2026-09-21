# DTI Proxy

Ein vorgeschalteter Proxy vor einer DTI-Instanz. Die zehn lesenden AAS-Endpunkte sind unter
einer neuen Basis-URL **unverändert** erreichbar, und dazu kommt die Discovery-Operation
`POST /lookup/shellsByAssetLink`, die das Zielsystem nicht hat.

## Was der Proxy anbietet

| Weg | Herkunft |
|---|---|
| `GET /shells/{aasIdentifier}` und die neun weiteren AAS-Pfade | 1:1 vom Zielsystem |
| `POST /lookup/shellsByAssetLink` | neu, Discovery Service Specification V3.1, Profil SSP-001 |
| `GET /swagger/index.html` | Swagger-Seite mit beidem, Discovery als eigener Abschnitt |
| `GET /admin` | Verwaltung: Anmeldung, Einstellungen, Discovery-Test |
| `GET /gesundheit` | Statusprobe |

Alles andere beantwortet der Proxy selbst mit 404. Die Connector-API und die Weboberfläche des
Zielsystems werden bewusst nicht durchgereicht.

## Discovery

Aus einer globalAssetId der Form `<schema><domain>/<itemID>` wird die itemID gezogen, davor
kommt die eingestellte Basis, dahinter `/aas` mit der itemID als Parameter.

```
https://viewer-pf.test.dti.neoception.dev/70133076
  -> https://viewer-pf.test.dti.neoception.dev/aas?itemId=70133076
```

Der Aufruf rechnet nur, er fragt das Zielsystem nicht. Bedient wird ausschließlich der Name
`globalAssetId`; jeder andere Name liefert `200` mit leerem `result`, keinen Fehler.

```bash
curl -X POST 'http://localhost:3000/lookup/shellsByAssetLink?limit=10' \
  -H 'content-type: application/json' \
  -d '[{"name":"globalAssetId","value":"https://viewer-pf.test.dti.neoception.dev/70133076"}]'
```

## Durchreichen heißt wirklich durchreichen

Gearbeitet wird mit der rohen Anfragezeile, nicht mit zerlegten Routenparametern. base64url-IDs
mit `-` und `_` und ein `%2F` im `idShortPath` erreichen das Zielsystem Zeichen für Zeichen so,
wie sie hereinkamen. `Authorization` wird weitergereicht, nur die Hop-by-Hop-Kopfzeilen fallen
weg. Statuscode, Kopfzeilen und Körper kommen unverändert zurück, einer Weiterleitung folgt der
Proxy nicht.

## Einstellungen

Verwaltet unter `/admin`, gespeichert in SQLite unter `DATA_DIR`.

| Schlüssel | Vorgabe | Bedeutung |
|---|---|---|
| `upstreamBasis` | `https://rc.test.dti.neoception.dev` | Ziel der zehn AAS-Aufrufe |
| `aasBasis` | `https://viewer-pf.test.dti.neoception.dev` | Schema und Domain der gebauten AAS-IDs |
| `proxyBasis` | leer | öffentliche Basis, leer heißt aus der Anfrage ableiten |
| `zeitlimitMs` | `30000` | Zeitlimit der Weiterleitung, 1000 bis 300000 |

## Umgebung

| Variable | Vorgabe | Anmerkung |
|---|---|---|
| `PORT` | `3000` | |
| `DATA_DIR` | `./daten` | im Container `/data`, muss auf das Volume zeigen |
| `WEB_DIR` | `../web/dist` | die gebaute Oberfläche |
| `ADMIN_USER` | `NeoAdmin` | |
| `ADMIN_PASSWORT` | `Password!2026` | |
| `SESSION_SECRET` | zufällig | bei `NODE_ENV=production` Pflicht, mindestens 16 Zeichen |

## Schnellstart unter Windows

`start.bat` doppelklicken. Das Skript installiert beim ersten Mal die Abhängigkeiten, baut
Oberfläche und Server, startet auf Port 3000 und öffnet die Verwaltung im Browser. Die Datenbank
landet in `daten\` neben dem Skript. Gebaut wird bei jedem Start, damit nie ein alter Stand läuft.

Zum Beenden Strg+C drücken oder das Fenster schließen. Abweichende Werte lassen sich vorher als
Umgebungsvariablen setzen, etwa `set PORT=3010`.

## Entwickeln

```bash
npm install
npm test                  # Server-Tests
npm run build             # Oberfläche und Server
npm run dev               # Server auf 3000
npm run dev --workspace @dti-proxy/web   # Oberfläche auf 5173 mit Weiterleitung auf 3000
```

## Container

```bash
docker build -t dti-proxy .
docker run -p 3000:3000 -v dti-proxy-daten:/data -e SESSION_SECRET=... dti-proxy
```
