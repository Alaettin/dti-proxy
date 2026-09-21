import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const ZUM_SERVER = ["/admin/api", "/lookup", "/swagger", "/gesundheit", "/description", "/shells", "/submodels", "/serialization"];

export default defineConfig({
  plugins: [react()],
  // Die Oberflaeche wird vom Server unter /admin ausgeliefert.
  base: "/admin/",
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: Object.fromEntries(ZUM_SERVER.map((pfad) => [pfad, { target: "http://localhost:3000", changeOrigin: false }])),
  },
});
