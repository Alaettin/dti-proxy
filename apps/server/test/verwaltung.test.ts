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

describe("Allgemeine Einstellungen", () => {
  it("sind ohne Anmeldung nicht lesbar", async () => {
    stand = pruefstand();
    expect((await json("/admin/api/einstellungen")).status).toBe(401);
  });

  it("sind ohne Anmeldung nicht schreibbar", async () => {
    stand = pruefstand();
    const antwort = await json("/admin/api/einstellungen", {
      methode: "PUT",
      koerper: { proxyBasis: "https://boese.test" },
    });
    expect(antwort.status).toBe(401);
    expect(stand.einstellungen.lesen("proxyBasis")).toBe("");
  });

  it("lassen sich angemeldet lesen und schreiben", async () => {
    stand = pruefstand();
    const cookie = await anmelden();

    const gelesen = await json("/admin/api/einstellungen", { cookie });
    expect(gelesen.status).toBe(200);
    expect((gelesen.koerper.werte as Record<string, string>).proxyBasis).toBe("");

    const geschrieben = await json("/admin/api/einstellungen", {
      methode: "PUT",
      cookie,
      koerper: { proxyBasis: "https://dti-proxy.test/" },
    });
    expect(geschrieben.status).toBe(200);
    expect(stand.einstellungen.lesen("proxyBasis")).toBe("https://dti-proxy.test");
  });

  it("weisen eine kaputte Basis ab und schreiben dann gar nichts", async () => {
    stand = pruefstand();
    const cookie = await anmelden();
    const antwort = await json("/admin/api/einstellungen", {
      methode: "PUT",
      cookie,
      koerper: { proxyBasis: "ftp://viewer.test" },
    });

    expect(antwort.status).toBe(400);
    expect(stand.einstellungen.lesen("proxyBasis")).toBe("");
  });
});

describe("Proxys über die Verwaltung", () => {
  it("sind ohne Anmeldung nicht lesbar", async () => {
    stand = pruefstand();
    expect((await json("/admin/api/proxys")).status).toBe(401);
  });

  it("listet den Standard mit seiner Basis-URL", async () => {
    stand = pruefstand();
    const cookie = await anmelden();
    const antwort = await json("/admin/api/proxys", { cookie });

    const liste = antwort.koerper.proxys as { kennung: string; standard: boolean; basisUrl: string }[];
    expect(liste).toHaveLength(1);
    expect(liste[0]!.kennung).toBe("standard");
    expect(liste[0]!.standard).toBe(true);
    expect(liste[0]!.basisUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("legt einen zweiten an und schlaegt die Kennung aus dem Namen vor", async () => {
    stand = pruefstand();
    const cookie = await anmelden();
    const antwort = await json("/admin/api/proxys", {
      methode: "POST",
      cookie,
      koerper: { name: "Kunde Ä", upstreamBasis: "https://zwei.test", aasBasis: "https://viewer-zwei.test" },
    });

    expect(antwort.status).toBe(201);
    const proxy = antwort.koerper.proxy as { kennung: string; standard: boolean; basisUrl: string };
    expect(proxy.kennung).toBe("kunde-ae");
    expect(proxy.standard).toBe(false);
    expect(proxy.basisUrl).toMatch(/\/p\/kunde-ae$/);
  });

  it("weist eine kaputte Kennung ab und nennt das richtige Feld", async () => {
    stand = pruefstand();
    const cookie = await anmelden();
    const antwort = await json("/admin/api/proxys", {
      methode: "POST",
      cookie,
      koerper: { name: "Zwei", kennung: "Kunde A", upstreamBasis: "https://zwei.test", aasBasis: "https://v.test" },
    });

    expect(antwort.status).toBe(400);
    const verstoesse = antwort.koerper.verstoesse as { feld: string }[];
    expect(verstoesse[0]!.feld).toBe("kennung");
    expect(stand.proxys.anzahl()).toBe(1);
  });

  it("aendert einen Proxy", async () => {
    stand = pruefstand();
    const cookie = await anmelden();
    await json("/admin/api/proxys", {
      methode: "POST",
      cookie,
      koerper: { name: "Zwei", upstreamBasis: "https://zwei.test", aasBasis: "https://v.test" },
    });
    const antwort = await json("/admin/api/proxys/zwei", {
      methode: "PUT",
      cookie,
      koerper: { upstreamBasis: "https://zwei-neu.test" },
    });

    expect(antwort.status).toBe(200);
    expect(stand.proxys.nachKennung("zwei")!.upstreamBasis).toBe("https://zwei-neu.test");
    // Nicht genannte Felder bleiben stehen.
    expect(stand.proxys.nachKennung("zwei")!.name).toBe("Zwei");
  });

  it("setzt den Standard um", async () => {
    stand = pruefstand();
    const cookie = await anmelden();
    await json("/admin/api/proxys", {
      methode: "POST",
      cookie,
      koerper: { name: "Zwei", upstreamBasis: "https://zwei.test", aasBasis: "https://v.test" },
    });
    const antwort = await json("/admin/api/proxys/zwei/standard", { methode: "POST", cookie });

    expect(antwort.status).toBe(200);
    expect(stand.proxys.standard()!.kennung).toBe("zwei");
    expect(stand.proxys.nachKennung("standard")!.standard).toBe(false);
  });

  it("loescht einen Proxy, aber nicht den letzten", async () => {
    stand = pruefstand();
    const cookie = await anmelden();
    await json("/admin/api/proxys", {
      methode: "POST",
      cookie,
      koerper: { name: "Zwei", upstreamBasis: "https://zwei.test", aasBasis: "https://v.test" },
    });

    expect((await json("/admin/api/proxys/zwei", { methode: "DELETE", cookie })).status).toBe(200);
    expect(stand.proxys.anzahl()).toBe(1);

    const letzter = await json("/admin/api/proxys/standard", { methode: "DELETE", cookie });
    expect(letzter.status).toBe(400);
    expect(stand.proxys.anzahl()).toBe(1);
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
    const antwort = await json("/admin/api/proxys/standard/pruefung", { methode: "POST", cookie });

    expect(antwort.koerper.erreichbar).toBe(true);
    expect(antwort.koerper.koerper).toBe('{"profiles":[10,12,16]}');
  });

  it("meldet einen Ausfall, statt selbst umzufallen", async () => {
    stand = pruefstand(() => {
      throw new Error("ECONNREFUSED");
    });
    const cookie = await anmelden();
    const antwort = await json("/admin/api/proxys/standard/pruefung", { methode: "POST", cookie });

    expect(antwort.status).toBe(200);
    expect(antwort.koerper.erreichbar).toBe(false);
    expect(String(antwort.koerper.fehler)).toContain("ECONNREFUSED");
  });
});
