import { appAnlegen } from "./app.js";
import { datenbankOeffnen } from "./db.js";
import { Einstellungen } from "./einstellungen.js";
import { konfiguration } from "./konfiguration.js";
import { Proxys } from "./proxys.js";

const db = datenbankOeffnen();
const einstellungen = new Einstellungen(db);
const proxys = new Proxys(db);
const app = appAnlegen({ einstellungen, proxys });

const server = app.listen(konfiguration.port, () => {
  console.log(`DTI Proxy läuft auf Port ${konfiguration.port}`);
  for (const proxy of proxys.alle()) {
    const wo = proxy.standard ? "/ (Standard)" : `/p/${proxy.kennung}`;
    console.log(`  ${wo.padEnd(24)} -> ${proxy.upstreamBasis}`);
  }
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
