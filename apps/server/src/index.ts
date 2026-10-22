import { appAnlegen } from "./app.js";
import { datenbankOeffnen } from "./db.js";
import { Einstellungen } from "./einstellungen.js";
import { Erneuerer } from "./erneuerung.js";
import { konfiguration } from "./konfiguration.js";
import { Proxys } from "./proxys.js";
import { SchalenPuffer } from "./puffer.js";

const db = datenbankOeffnen();
const einstellungen = new Einstellungen(db);
const proxys = new Proxys(db);
const puffer = new SchalenPuffer();
const erneuerer = new Erneuerer({ proxys, puffer });
const app = appAnlegen({ einstellungen, proxys, puffer, erneuerer });
// Beim Start ist jeder puffernde Proxy sofort faellig, danach alle pufferStunden.
erneuerer.starten();

const server = app.listen(konfiguration.port, () => {
  // Ohne Umlaute: die Zeichentabelle des Konsolenfensters macht daraus sonst
  // Buchstabensalat. Dieselbe Ueberlegung wie in start.bat.
  console.log(`DTI Proxy laeuft auf Port ${konfiguration.port}`);
  const alle = proxys.alle();
  if (alle.length === 0) {
    console.log("  Noch kein Proxy angelegt, das geht in der Verwaltung unter /admin");
  }
  for (const proxy of alle) {
    console.log(`  /p/${proxy.kennung}`.padEnd(26) + `-> ${proxy.upstreamBasis}`);
  }
  console.log(`Datenbank: ${konfiguration.datenbankDatei}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    erneuerer.stoppen();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
