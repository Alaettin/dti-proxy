import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { pruefstand, roheAnfrage, type Pruefstand } from "./hilfe.js";

// Die Auslieferung der Oberflaeche haengt an einer Bedingung (Verzeichnis
// vorhanden). Ohne dieses Verzeichnis waere der ganze Zweig ungeprueft,
// deshalb wird er hier hergestellt statt uebersprungen.
let webVerzeichnis: string;

beforeAll(() => {
  webVerzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "dti-proxy-web-"));
  fs.writeFileSync(path.join(webVerzeichnis, "index.html"), "<!doctype html><div id=wurzel></div>");
  fs.writeFileSync(path.join(webVerzeichnis, "stil.css"), "body{}");
});

let stand: Pruefstand | undefined;

afterEach(() => {
  stand?.schliessen();
  stand = undefined;
});

describe("Oberflaeche unter /admin", () => {
  it("liefert die Seite", async () => {
    stand = pruefstand(undefined, { webVerzeichnis });
    const antwort = await roheAnfrage(stand.app, "/admin/");
    expect(antwort.status).toBe(200);
    expect(antwort.koerper).toContain("wurzel");
  });

  it("liefert eigene Dateien aus", async () => {
    stand = pruefstand(undefined, { webVerzeichnis });
    expect((await roheAnfrage(stand.app, "/admin/stil.css")).status).toBe(200);
  });

  it("gibt einen unbekannten Weg der Oberflaeche an ihre index.html", async () => {
    stand = pruefstand(undefined, { webVerzeichnis });
    const antwort = await roheAnfrage(stand.app, "/admin/einstellungen");
    expect(antwort.status).toBe(200);
    expect(antwort.koerper).toContain("wurzel");
  });

  it("gibt einen unbekannten Weg unter /admin/api NICHT an die index.html", async () => {
    stand = pruefstand(undefined, { webVerzeichnis });
    const antwort = await roheAnfrage(stand.app, "/admin/api/gibtsnicht");
    expect(antwort.status).toBe(404);
    expect(antwort.koerper).not.toContain("wurzel");
    expect(JSON.parse(antwort.koerper)).toHaveProperty("messages");
  });

  it("stellt die API vor die Rueckfallroute", async () => {
    stand = pruefstand(undefined, { webVerzeichnis });
    const antwort = await roheAnfrage(stand.app, "/admin/api/sitzung");
    expect(antwort.status).toBe(200);
    expect(JSON.parse(antwort.koerper)).toEqual({ angemeldet: false, benutzer: null });
  });
});

describe("Wurzel", () => {
  it("leitet auf die Swagger-Seite", async () => {
    stand = pruefstand(undefined, { webVerzeichnis });
    const antwort = await roheAnfrage(stand.app, "/");
    expect(antwort.status).toBe(302);
    expect(antwort.kopfzeilen.location).toBe("/swagger/index.html");
  });
});
