import { defineConfig } from "vitest/config";

// Eigene Datei statt Flaggen am Aufruf: vitest 4 kennt --include nicht mehr,
// und ohne disableConsoleIntercept verschluckt der Lauf die Ausgaben der Tests.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    disableConsoleIntercept: true,
    restoreMocks: true,
  },
});
