# DTI Proxy

Vorgeschaltete Proxys vor DTI-Instanzen. Je Proxy sind die zehn lesenden AAS-Endpunkte unter
einer neuen Basis-URL **unverändert** erreichbar, und dazu kommt die Discovery-Operation
`POST /lookup/shellsByAssetLink`, die das Zielsystem nicht hat.

Ein Dienst trägt beliebig viele Proxys, verwaltet über die Übersicht unter `/admin`. Ein Login
für alle.

## Mehrere Proxys

Man legt einen Proxy mit Namen an, daraus wird eine Kennung, und unter dieser Kennung ist er
erreichbar. Alle Proxys sind gleichberechtigt, keiner liegt an der Wurzel.

```
https://proxy.example/p/rc/shells/<id>         ein Proxy
https://proxy.example/p/kunde-a/shells/<id>    ein zweiter
https://proxy.example/p/kunde-a/swagger        dessen eigene Swagger-Seite
```

Die Kennung wird beim Anlegen aus dem Namen abgeleitet und ist bis zum Speichern änderbar.
Danach bleibt sie stehen: ein späteres Umbenennen ändert die Adresse nicht, sonst bräche sie
allen Aufrufern weg.

Eine frische Installation hat noch keinen Proxy. Den ersten legt man unter `/admin` an.

## Was ein Proxy anbietet

| Weg | Herkunft |
|---|---|
| `GET /shells/{aasIdentifier}` und die neun weiteren AAS-Pfade | 1:1 vom Zielsystem |
| `POST /lookup/shellsByAssetLink` | neu, Discovery Service Specification V3.1, Profil SSP-001 |
| `GET /swagger/index.html` | Swagger-Seite mit beidem, Discovery als eigener Abschnitt |

Dazu für den ganzen Dienst:

| Weg | Zweck |
|---|---|
| `GET /admin` | Verwaltung: Übersicht, Einstellungen, API-Prüfstand |
| `GET /gesundheit` | Statusprobe |

Alles andere beantwortet der Proxy selbst mit 404. Die Connector-API und die Weboberfläche des
Zielsystems werden bewusst nicht durchgereicht.

## Discovery

Aus einer globalAssetId wird die itemID gezogen, davor kommt die eingestellte Basis, dahinter
`/aas` mit der itemID als Parameter.

Zwei Eingabeformen kommen vor. Bei `<schema><domain>/<itemID>` ist die itemID das letzte
Pfadsegment. Liegt der Bezeichner bereits in der Zielform vor, steht die itemID im Query-Teil
und hat Vorrang, sonst käme als itemID das Pfadsegment `aas` heraus.

```
https://viewer-rc.test.dti.neoception.dev/70133076
  -> https://viewer-rc.test.dti.neoception.dev/aas?itemId=70133076

https://viewer-rc.test.dti.neoception.dev/aas?itemId=VNDP77EV202504291
  -> https://viewer-rc.test.dti.neoception.dev/aas?itemId=VNDP77EV202504291
```

Der Aufruf rechnet nur, er fragt das Zielsystem nicht. Bedient wird ausschließlich der Name
`globalAssetId`; jeder andere Name liefert `200` mit leerem `result`, keinen Fehler.

```bash
curl -X POST 'http://localhost:3000/p/rc/lookup/shellsByAssetLink?limit=10' \
  -H 'content-type: application/json' \
  -d '[{"name":"globalAssetId","value":"https://viewer-rc.test.dti.neoception.dev/VNDP77EV202504291"}]'
```

## Durchreichen heißt wirklich durchreichen

Gearbeitet wird mit der rohen Anfragezeile, nicht mit zerlegten Routenparametern. Auch das
Präfix `/p/<kennung>` wird nur abgeschnitten, nie zerlegt und neu zusammengesetzt.
base64url-IDs mit `-` und `_` und ein `%2F` im `idShortPath` erreichen das Zielsystem Zeichen
für Zeichen so, wie sie hereinkamen. `Authorization` wird weitergereicht, nur die
Hop-by-Hop-Kopfzeilen fallen weg. Statuscode, Kopfzeilen und Körper kommen unverändert zurück,
einer Weiterleitung folgt der Proxy nicht.

## Einstellungen

Verwaltet unter `/admin`, gespeichert in SQLite unter `DATA_DIR`.

Je Proxy:

| Feld | Bedeutung |
|---|---|
| `name` | nur zur Anzeige |
| `kennung` | steht in der Adresse unter `/p/`, Kleinbuchstaben, Ziffern, Bindestriche, höchstens 40 Zeichen |
| `upstreamBasis` | Ziel der zehn AAS-Aufrufe |
| `aasBasis` | Schema und Domain der gebauten AAS-IDs |
| `zeitlimitMs` | Zeitlimit der Weiterleitung, 1000 bis 300000 |

Für den ganzen Dienst:

| Schlüssel | Vorgabe | Bedeutung |
|---|---|---|
| `proxyBasis` | leer | öffentliche Basis, leer heißt aus der Anfrage ableiten |

Zwei Wanderungen laufen beim Start von selbst und wiederholt folgenlos: eine Installation mit
nur einer Einstellungsreihe wird zu einem Proxy „Standard" mit genau diesen Werten, und eine
aus der Fassung mit einem ausgezeichneten Standardproxy verliert diese Sonderrolle, behält aber
alle Proxys.

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
Oberfläche und Server, startet auf Port 3000 und öffnet die Verwaltung im Browser. Dort legt man
den ersten Proxy an. Die Datenbank landet in `daten\` neben dem Skript. Gebaut wird bei jedem
Start, damit nie ein alter Stand läuft.

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
