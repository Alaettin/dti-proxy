import { afterEach, describe, expect, it } from "vitest";
import { pruefstand, roheAnfrage, TEST_BENUTZER, TEST_PASSWORT, type Pruefstand } from "./hilfe.js";

let stand: Pruefstand | undefined;

afterEach(() => {
  stand?.schliessen();
  stand = undefined;
});

async function json(
  pfad: string,
  optionen: { methode?: string; koerper?: unknown; cookie?: string } = {},
): Promise<{ status: number; koerper: Record<string, unknown>; cookie: string | undefined }> {
  const text = optionen.koerper === undefined ? undefined : JSON.stringify(optionen.koerper);
  const kopfzeilen: Record<string, string> = {};
  if (text !== undefined) {
    kopfzeilen["content-type"] = "application/json";
    kopfzeilen["content-length"] = String(Buffer.byteLength(text));
  }
  if (optionen.cookie) kopfzeilen.cookie = optionen.cookie;

  const antwort = await roheAnfrage(stand!.app, pfad, {
    methode: optionen.methode ?? "GET",
    kopfzeilen,
    koerper: text,
  });
  const gesetzt = antwort.kopfzeilen["set-cookie"];
  const cookie = Array.isArray(gesetzt) ? gesetzt[0]?.split(";")[0] : undefined;
  return { status: antwort.status, koerper: JSON.parse(antwort.koerper) as Record<string, unknown>, cookie };
}

async function anmelden(): Promise<string> {
  const antwort = await json("/admin/api/anmelden", {
    methode: "POST",
    koerper: { benutzer: TEST_BENUTZER, passwort: TEST_PASSWORT },
  });
  expect(antwort.status).toBe(200);
  expect(antwort.cookie).toBeTruthy();
  return antwort.cookie!;
}

describe("Anmeldung", () => {
  it("laesst die richtigen Zugangsdaten durch", async () => {
    stand = pruefstand();
    const cookie = await anmelden();
    const sitzung = await json("/admin/api/sitzung", { cookie });
    expect(sitzung.koerper).toEqual({ angemeldet: true, benutzer: TEST_BENUTZER });
  });

  it("weist ein falsches Passwort ab", async () => {
    stand = pruefstand();
    const antwort = await json("/admin/api/anmelden", {
      methode: "POST",
      koerper: { benutzer: TEST_BENUTZER, passwort: "falsch" },
    });
    expect(antwort.status).toBe(401);
    expect(antwort.cookie).toBeUndefined();
  });

  it("weist einen falschen Benutzer ab", async () => {
    stand = pruefstand();
    const antwort = await json("/admin/api/anmelden", {
      methode: "POST",
      koerper: { benutzer: "wer-auch-immer", passwort: TEST_PASSWORT },
    });
    expect(antwort.status).toBe(401);
  });

  it("sperrt nach fuenf Fehlversuchen", async () => {
    stand = pruefstand();
    for (let versuch = 0; versuch < 5; versuch += 1) {
      await json("/admin/api/anmelden", { methode: "POST", koerper: { benutzer: "x", passwort: "y" } });
    }
    const antwort = await json("/admin/api/anmelden", {
      methode: "POST",
      koerper: { benutzer: TEST_BENUTZER, passwort: TEST_PASSWORT },
    });
    expect(antwort.status).toBe(429);
  });

  it("nimmt ein gefaelschtes Cookie nicht an", async () => {
    stand = pruefstand();
    const nutzlast = Buffer.from(JSON.stringify({ benutzer: "NeoAdmin", bis: Date.now() + 10_000 })).toString(
      "base64url",
    );
    const antwort = await json("/admin/api/einstellungen", {
      cookie: `dti_proxy_sitzung=${nutzlast}.falscheunterschrift`,
    });
    expect(antwort.status).toBe(401);
  });

  // Beide Richtungen: ein Secure-Cookie ueber reines HTTP wird vom Browser
  // verworfen, dann kann sich niemand anmelden. Und ohne Secure hinter HTTPS
  // waere die Sitzung unnoetig ungeschuetzt.
  it("setzt ueber reines HTTP kein Secure am Cookie", async () => {
    stand = pruefstand();
    const antwort = await roheAnfrage(stand.app, "/admin/api/anmelden", {
      methode: "POST",
      kopfzeilen: { "content-type": "application/json" },
      koerper: JSON.stringify({ benutzer: TEST_BENUTZER, passwort: TEST_PASSWORT }),
    });
    const cookie = (antwort.kopfzeilen["set-cookie"] as string[])[0]!;
    expect(cookie).not.toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("setzt Secure, wenn die Verbindung laut X-Forwarded-Proto https ist", async () => {
    stand = pruefstand();
    const antwort = await roheAnfrage(stand.app, "/admin/api/anmelden", {
      methode: "POST",
      kopfzeilen: { "content-type": "application/json", "x-forwarded-proto": "https" },
      koerper: JSON.stringify({ benutzer: TEST_BENUTZER, passwort: TEST_PASSWORT }),
    });
    const cookie = (antwort.kopfzeilen["set-cookie"] as string[])[0]!;
    expect(cookie).toMatch(/;\s*Secure/i);
  });

  it("meldet ab", async () => {
    stand = pruefstand();
    const cookie = await anmelden();
    await json("/admin/api/abmelden", { methode: "POST", cookie });
    // Das Cookie ist nun geloescht; ein Aufruf ohne Cookie ist nicht angemeldet.
    const sitzung = await json("/admin/api/sitzung");
    expect(sitzung.koerper.angemeldet).toBe(false);
  });
});

describe("Einstellungen", () => {
  it("sind ohne Anmeldung nicht lesbar", async () => {
    stand = pruefstand();
    expect((await json("/admin/api/einstellungen")).status).toBe(401);
  });

  it("sind ohne Anmeldung nicht schreibbar", async () => {
    stand = pruefstand();
    const antwort = await json("/admin/api/einstellungen", {
      methode: "PUT",
      koerper: { upstreamBasis: "https://boese.test" },
    });
    expect(antwort.status).toBe(401);
    expect(stand.einstellungen.lesen("upstreamBasis")).toBe("https://oben.beispiel.test");
  });

  it("lassen sich angemeldet lesen und schreiben", async () => {
    stand = pruefstand();
    const cookie = await anmelden();

    const gelesen = await json("/admin/api/einstellungen", { cookie });
    expect(gelesen.status).toBe(200);
    expect((gelesen.koerper.werte as Record<string, string>).upstreamBasis).toBe("https://oben.beispiel.test");

    const geschrieben = await json("/admin/api/einstellungen", {
      methode: "PUT",
      cookie,
      koerper: { aasBasis: "https://viewer.test/", zeitlimitMs: "5000" },
    });
    expect(geschrieben.status).toBe(200);
    expect(stand.einstellungen.lesen("aasBasis")).toBe("https://viewer.test");
    expect(stand.einstellungen.lesen("zeitlimitMs")).toBe("5000");
  });

  it("weisen eine kaputte Basis ab und schreiben dann gar nichts", async () => {
    stand = pruefstand();
    const cookie = await anmelden();
    const antwort = await json("/admin/api/einstellungen", {
      methode: "PUT",
      cookie,
      koerper: { aasBasis: "ftp://viewer.test", zeitlimitMs: "5000" },
    });

    expect(antwort.status).toBe(400);
    expect(stand.einstellungen.lesen("zeitlimitMs")).toBe("30000");
    expect(stand.einstellungen.lesen("aasBasis")).toBe("https://viewer-pf.test.dti.neoception.dev");
  });

  it("weisen ein Zeitlimit ausserhalb der Spanne ab", async () => {
    stand = pruefstand();
    const cookie = await anmelden();
    const antwort = await json("/admin/api/einstellungen", { methode: "PUT", cookie, koerper: { zeitlimitMs: "10" } });
    expect(antwort.status).toBe(400);
  });
});

describe("Verbindungspruefung", () => {
  it("meldet, was das Zielsystem sagt", async () => {
    stand = pruefstand((aufruf) =>
      aufruf.url.endsWith("/description")
        ? new Response('{"profiles":[10,12,16]}', { status: 200 })
        : new Response("{}", { status: 404 }),
    );
    const cookie = await anmelden();
    const antwort = await json("/admin/api/pruefung", { methode: "POST", cookie });

    expect(antwort.koerper.erreichbar).toBe(true);
    expect(antwort.koerper.koerper).toBe('{"profiles":[10,12,16]}');
  });

  it("meldet einen Ausfall, statt selbst umzufallen", async () => {
    stand = pruefstand(() => {
      throw new Error("ECONNREFUSED");
    });
    const cookie = await anmelden();
    const antwort = await json("/admin/api/pruefung", { methode: "POST", cookie });

    expect(antwort.status).toBe(200);
    expect(antwort.koerper.erreichbar).toBe(false);
    expect(String(antwort.koerper.fehler)).toContain("ECONNREFUSED");
  });
});
