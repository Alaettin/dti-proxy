import { afterEach, describe, expect, it } from "vitest";
import { PRUEF_BASIS, PRUEF_KENNUNG, pruefstand, roheAnfrage, type Pruefstand } from "./hilfe.js";

let stand: Pruefstand | undefined;

afterEach(() => {
  stand?.schliessen();
  stand = undefined;
});

describe("Weiterleitung", () => {
  it("reicht den rohen Pfad zeichengenau nach oben", async () => {
    // Beide Stolpersteine in einem Pfad: base64url mit - und _, und ein %2F,
    // das nach dem Dekodieren ein Trenner waere.
    const pfad =
      "/submodels/aHR0cDovL2E-Yg_c/submodel-elements/Nameplate%2FManufacturerName?level=Deep&extent=WithBlobValue";
    stand = pruefstand();
    const antwort = await roheAnfrage(stand.app, PRUEF_BASIS + pfad);

    expect(antwort.status).toBe(200);
    expect(stand.aufrufe).toHaveLength(1);
    // Das Praefix faellt weg, der Rest kommt Zeichen fuer Zeichen an.
    expect(stand.aufrufe[0]!.url).toBe("https://oben.beispiel.test" + pfad);
  });

  // Gegenprobe zum Wegfall des Standards: an der Wurzel liegt kein Proxy mehr.
  it("bedient die Wurzel nicht mehr und fragt dort niemanden", async () => {
    stand = pruefstand();
    for (const pfad of ["/description", "/shells/QUJD", "/submodels/QUJD/submodel-elements/A%2FB"]) {
      const antwort = await roheAnfrage(stand.app, pfad);
      expect(antwort.status, pfad).toBe(404);
    }
    expect(stand.aufrufe).toHaveLength(0);
  });

  it("kennt eine unbekannte Kennung nicht", async () => {
    stand = pruefstand();
    const antwort = await roheAnfrage(stand.app, "/p/gibtsnicht/description");

    expect(antwort.status).toBe(404);
    expect(stand.aufrufe).toHaveLength(0);
  });

  it("reicht Authorization durch und die Hop-by-Hop-Kopfzeilen nicht", async () => {
    stand = pruefstand();
    await roheAnfrage(stand.app, PRUEF_BASIS + "/description", {
      kopfzeilen: {
        authorization: "Bearer abc.def.ghi",
        "accept-language": "de-DE",
        connection: "keep-alive",
        "proxy-authorization": "Basic Zm9v",
      },
    });

    const kopfzeilen = stand.aufrufe[0]!.kopfzeilen;
    expect(kopfzeilen.authorization).toBe("Bearer abc.def.ghi");
    expect(kopfzeilen["accept-language"]).toBe("de-DE");
    expect(kopfzeilen.connection).toBeUndefined();
    expect(kopfzeilen["proxy-authorization"]).toBeUndefined();
    expect(kopfzeilen.host).toBeUndefined();
  });

  it("gibt Status, Kopfzeilen und Koerper von oben unveraendert zurueck", async () => {
    stand = pruefstand(
      () =>
        new Response('{"idShort":"Nameplate"}', {
          status: 404,
          headers: { "content-type": "application/json", "x-eigenes-feld": "erhalten" },
        }),
    );
    const antwort = await roheAnfrage(stand.app, PRUEF_BASIS + "/submodels/QUJD");

    expect(antwort.status).toBe(404);
    expect(antwort.kopfzeilen["x-eigenes-feld"]).toBe("erhalten");
    expect(antwort.kopfzeilen["content-type"]).toBe("application/json");
    expect(antwort.koerper).toBe('{"idShort":"Nameplate"}');
  });

  it("reicht eine Weiterleitung von oben durch, statt ihr zu folgen", async () => {
    stand = pruefstand(() => new Response(null, { status: 302, headers: { location: "https://woanders.test/x" } }));
    const antwort = await roheAnfrage(stand.app, PRUEF_BASIS + "/description");

    expect(antwort.status).toBe(302);
    expect(antwort.kopfzeilen.location).toBe("https://woanders.test/x");
  });

  it("antwortet 502 in Result-Form, wenn das Ziel nicht erreichbar ist", async () => {
    stand = pruefstand(() => {
      throw new Error("getaddrinfo ENOTFOUND oben.beispiel.test");
    });
    const antwort = await roheAnfrage(stand.app, PRUEF_BASIS + "/description");

    expect(antwort.status).toBe(502);
    const koerper = JSON.parse(antwort.koerper) as { messages: { code: string; timestamp: string; text: string }[] };
    expect(koerper.messages[0]!.code).toBe("502");
    expect(koerper.messages[0]!.timestamp).toBe("2026-09-18T09:12:44.000Z");
    expect(koerper.messages[0]!.text).toContain("not reachable");
  });

  it("antwortet 502, wenn das Ziel das Zeitlimit reisst", async () => {
    stand = pruefstand(async (): Promise<Response> => {
      await new Promise((warten) => setTimeout(warten, 1500));
      return new Response("{}");
    });
    stand.proxys.aendern(PRUEF_KENNUNG, { zeitlimitMs: "1000" });
    const antwort = await roheAnfrage(stand.app, PRUEF_BASIS + "/description");

    expect(antwort.status).toBe(502);
    expect(antwort.koerper).toContain("did not answer within 1000 ms");
  });

  it("laesst nur GET und HEAD auf den weitergereichten Pfaden zu", async () => {
    stand = pruefstand();
    const antwort = await roheAnfrage(stand.app, PRUEF_BASIS + "/submodels/QUJD", { methode: "DELETE" });

    expect(antwort.status).toBe(405);
    expect(antwort.kopfzeilen.allow).toBe("GET, HEAD");
    expect(stand.aufrufe).toHaveLength(0);
  });

  it("reicht fremde Pfade nicht weiter, sondern antwortet selbst mit 404", async () => {
    stand = pruefstand();
    const antwort = await roheAnfrage(stand.app, PRUEF_BASIS + "/api/connector/model");

    expect(antwort.status).toBe(404);
    expect(stand.aufrufe).toHaveLength(0);
    expect(antwort.koerper).toContain("No route for");
  });
});
