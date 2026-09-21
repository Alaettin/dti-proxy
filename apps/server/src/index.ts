import { appAnlegen } from "./app.js";
import { datenbankOeffnen } from "./db.js";
import { Einstellungen } from "./einstellungen.js";
import { konfiguration } from "./konfiguration.js";

const db = datenbankOeffnen();
const einstellungen = new Einstellungen(db);
const app = appAnlegen({ einstellungen });

const server = app.listen(konfiguration.port, () => {
  console.log(`DTI Proxy läuft auf Port ${konfiguration.port}`);
  console.log(`Ziel: ${einstellungen.lesen("upstreamBasis")}`);
  console.log(`Datenbank: ${konfiguration.datenbankDatei}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
