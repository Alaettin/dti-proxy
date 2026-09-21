import { afterEach, describe, expect, it } from "vitest";
import { aasIdBauen, itemIdAus } from "../src/routen/discovery.js";
import { PRUEF_BASIS, PRUEF_KENNUNG, pruefstand, roheAnfrage, type Pruefstand } from "./hilfe.js";

let stand: Pruefstand | undefined;

afterEach(() => {
  stand?.schliessen();
  stand = undefined;
});

interface Antwort {
  status: number;
  koerper: { paging_metadata?: { cursor?: string }; result?: string[]; messages?: { text: string; code: string }[] };
}

async function lookup(pfadZusatz: string, koerper: unknown): Promise<Antwort> {
  const text = typeof koerper === "string" ? koerper : JSON.stringify(koerper);
  const antwort = await roheAnfrage(stand!.app, PRUEF_BASIS + "/lookup/shellsByAssetLink" + pfadZusatz, {
    methode: "POST",
    kopfzeilen: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) },
    koerper: text,
  });
  return { status: antwort.status, koerper: JSON.parse(antwort.koerper) as Antwort["koerper"] };
}

describe("itemIdAus", () => {
  it("nimmt das letzte Pfadsegment", () => {
    expect(itemIdAus("https://viewer-rc.test.dti.neoception.dev/70133076")).toBe("70133076");
    expect(itemIdAus("https://example.com/assets/ABC123")).toBe("ABC123");
  });

  // Liegt der Bezeichner schon in der Zielform vor, waere das letzte
  // Pfadsegment "aas" und das Ergebnis Unsinn. Der Query-Teil hat Vorrang.
  it("nimmt itemId aus dem Query-Teil, wenn er da ist", () => {
    expect(itemIdAus("https://viewer-rc.test.dti.neoception.dev/aas?itemId=VNDP77EV202504291")).toBe(
      "VNDP77EV202504291",
    );
  });

  it("nimmt itemId auch bei abweichender Gross- und Kleinschreibung", () => {
    expect(itemIdAus("https://viewer-rc.test.dti.neoception.dev/aas?ITEMID=ABC")).toBe("ABC");
  });

  it("nimmt itemId auch neben anderen Parametern", () => {
    expect(itemIdAus("https://viewer-rc.test.dti.neoception.dev/aas?x=1&itemId=ABC&y=2")).toBe("ABC");
  });

  it("faellt auf das Pfadsegment zurueck, wenn itemId leer ist", () => {
    expect(itemIdAus("https://viewer-rc.test.dti.neoception.dev/70133076?itemId=")).toBe("70133076");
  });

  it("ignoriert einen abschliessenden Schraegstrich", () => {
    expect(itemIdAus("https://example.com/assets/ABC123/")).toBe("ABC123");
  });

  it("dekodiert das Segment", () => {
    expect(itemIdAus("https://example.com/A%20B")).toBe("A B");
  });

  it("gibt null, wenn kein Segment da ist oder der Wert keine URL ist", () => {
    expect(itemIdAus("https://example.com/")).toBeNull();
    expect(itemIdAus("nur-ein-text")).toBeNull();
  });
});

describe("aasIdBauen", () => {
  it("baut die Form aus der Anforderung", () => {
    expect(aasIdBauen("https://viewer-rc.test.dti.neoception.dev", "70133076")).toBe(
      "https://viewer-rc.test.dti.neoception.dev/aas?itemId=70133076",
    );
  });

  it("kodiert Sonderzeichen in der itemID", () => {
    expect(aasIdBauen("https://x.test", "A B&C")).toBe("https://x.test/aas?itemId=A%20B%26C");
  });
});

describe("POST /lookup/shellsByAssetLink", () => {
  it("findet die Shell zur globalAssetId", async () => {
    stand = pruefstand();
    const antwort = await lookup("", [
      { name: "globalAssetId", value: "https://viewer-rc.test.dti.neoception.dev/70133076" },
    ]);

    expect(antwort.status).toBe(200);
    expect(antwort.koerper).toEqual({
      paging_metadata: {},
      result: ["https://viewer-rc.test.dti.neoception.dev/aas?itemId=70133076"],
    });
    // Discovery rechnet nur, es geht kein Aufruf nach oben.
    expect(stand.aufrufe).toHaveLength(0);
  });

  // Der gemeldete Fehler: die Eingabe lag schon in der Zielform vor, und
  // heraus kam "...?itemId=aas".
  it("gibt eine Kennung in der Zielform unveraendert zurueck", async () => {
    const kennung = "https://viewer-rc.test.dti.neoception.dev/aas?itemId=VNDP77EV202504291";
    stand = pruefstand();
    const antwort = await lookup("", [{ name: "globalAssetId", value: kennung }]);

    expect(antwort.status).toBe(200);
    expect(antwort.koerper.result).toEqual([kennung]);
  });

  it("nutzt die Basis aus den Einstellungen", async () => {
    stand = pruefstand();
    stand.proxys.aendern(PRUEF_KENNUNG, { aasBasis: "https://anders.test/unterpfad" });
    const antwort = await lookup("", [{ name: "globalAssetId", value: "https://egal.test/4711" }]);

    expect(antwort.koerper.result).toEqual(["https://anders.test/unterpfad/aas?itemId=4711"]);
  });

  it("antwortet 200 mit leerem result bei einem fremden Bezeichnernamen", async () => {
    stand = pruefstand();
    const antwort = await lookup("", [{ name: "serialNumber", value: "https://example.com/assets/ABC123" }]);

    expect(antwort.status).toBe(200);
    expect(antwort.koerper).toEqual({ paging_metadata: {}, result: [] });
  });

  it("antwortet 200 mit leerem result, wenn keine itemID herausfaellt", async () => {
    stand = pruefstand();
    const antwort = await lookup("", [{ name: "globalAssetId", value: "kein-url-wert" }]);

    expect(antwort.status).toBe(200);
    expect(antwort.koerper.result).toEqual([]);
  });

  it("entfernt Doppelte", async () => {
    stand = pruefstand();
    const antwort = await lookup("", [
      { name: "globalAssetId", value: "https://a.test/1" },
      { name: "globalAssetId", value: "https://b.test/1" },
    ]);

    expect(antwort.koerper.result).toHaveLength(1);
  });

  it("blaettert mit limit und cursor", async () => {
    stand = pruefstand();
    const eingabe = [1, 2, 3].map((n) => ({ name: "globalAssetId", value: `https://a.test/${n}` }));

    const erste = await lookup("?limit=2", eingabe);
    expect(erste.koerper.result).toHaveLength(2);
    const cursor = erste.koerper.paging_metadata?.cursor;
    expect(cursor).toBeTruthy();

    const zweite = await lookup(`?limit=2&cursor=${cursor}`, eingabe);
    expect(zweite.koerper.result).toEqual(["https://viewer-rc.test.dti.neoception.dev/aas?itemId=3"]);
    expect(zweite.koerper.paging_metadata).toEqual({});
  });

  describe("400", () => {
    it("bei fehlendem value", async () => {
      stand = pruefstand();
      const antwort = await lookup("", [{ name: "globalAssetId" }]);
      expect(antwort.status).toBe(400);
      expect(antwort.koerper.messages?.[0]?.text).toBe("Property 'value' is required.");
    });

    it("bei fehlendem name", async () => {
      stand = pruefstand();
      const antwort = await lookup("", [{ value: "https://a.test/1" }]);
      expect(antwort.status).toBe(400);
      expect(antwort.koerper.messages?.[0]?.text).toBe("Property 'name' is required.");
    });

    it("wenn der Koerper kein Array ist", async () => {
      stand = pruefstand();
      const antwort = await lookup("", { name: "globalAssetId", value: "https://a.test/1" });
      expect(antwort.status).toBe(400);
      expect(antwort.koerper.messages?.[0]?.text).toContain("must be a JSON array");
    });

    it("wenn der Koerper eine leere Liste ist", async () => {
      stand = pruefstand();
      const antwort = await lookup("", []);
      expect(antwort.status).toBe(400);
      expect(antwort.koerper.messages?.[0]?.text).toContain("at least one asset link");
    });

    it("wenn value zu lang ist", async () => {
      stand = pruefstand();
      const antwort = await lookup("", [{ name: "globalAssetId", value: "x".repeat(2049) }]);
      expect(antwort.status).toBe(400);
      expect(antwort.koerper.messages?.[0]?.text).toBe("Property 'value' must be between 1 and 2048 characters.");
    });

    it("wenn name zu lang ist", async () => {
      stand = pruefstand();
      const antwort = await lookup("", [{ name: "x".repeat(65), value: "https://a.test/1" }]);
      expect(antwort.status).toBe(400);
      expect(antwort.koerper.messages?.[0]?.text).toBe("Property 'name' must be between 1 and 64 characters.");
    });

    it("bei limit 0", async () => {
      stand = pruefstand();
      const antwort = await lookup("?limit=0", [{ name: "globalAssetId", value: "https://a.test/1" }]);
      expect(antwort.status).toBe(400);
      expect(antwort.koerper.messages?.[0]?.text).toContain("'limit'");
    });

    it("bei kaputtem cursor", async () => {
      stand = pruefstand();
      const antwort = await lookup("?cursor=!!!", [{ name: "globalAssetId", value: "https://a.test/1" }]);
      expect(antwort.status).toBe(400);
      expect(antwort.koerper.messages?.[0]?.text).toContain("'cursor'");
    });

    it("bei kaputtem JSON, und nicht als HTML-Fehlerseite", async () => {
      stand = pruefstand();
      const antwort = await lookup("", "{nicht json");
      expect(antwort.status).toBe(400);
      expect(antwort.koerper.messages?.[0]?.text).toBe("The request body is not valid JSON.");
    });
  });
});
