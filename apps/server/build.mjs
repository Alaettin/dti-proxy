import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/index.js",
  sourcemap: true,
  // better-sqlite3 ist ein natives Modul und darf nie mitgebuendelt werden,
  // swagger-ui-dist wird zur Laufzeit als Verzeichnis aufgeloest.
  external: ["better-sqlite3", "swagger-ui-dist"],
  banner: {
    js: "import{createRequire as __erfordern}from'node:module';const require=__erfordern(import.meta.url);",
  },
});

console.log("dist/index.js gebaut");
