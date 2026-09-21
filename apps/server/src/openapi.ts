import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DISCOVERY_PFAD } from "./pfade.js";
import { DISCOVERY_FASSUNG, DISCOVERY_PROFIL } from "./routen/discovery.js";

export interface OpenApiDokument {
  openapi: string;
  info: { title: string; version: string };
  servers: { url: string }[];
  paths: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
  tags?: { name: string; description?: string }[];
  [weiteres: string]: unknown;
}

const hier = path.dirname(fileURLToPath(import.meta.url));

/** Rueckfall, falls das Zielsystem gerade nicht antwortet. */
export function mitgelieferteSpec(): OpenApiDokument {
  const datei = path.resolve(hier, "../spec/aas.swagger.json");
  return JSON.parse(readFileSync(datei, "utf8")) as OpenApiDokument;
}

function discoveryPfad(): Record<string, unknown> {
  return {
    post: {
      tags: ["Discovery"],
      summary: "SearchAllAssetAdministrationShellIdsByAssetLink",
      description:
        `Liefert die Kennungen der Asset Administration Shells zu einem Asset-Bezeichner. ` +
        `Discovery Service Specification V${DISCOVERY_FASSUNG}, Profil SSP-001 (${DISCOVERY_PROFIL}). ` +
        `Bedient wird ausschließlich der Name globalAssetId. Wird nichts gefunden, ist die Antwort 200 mit leerem result.`,
      operationId: "SearchAllAssetAdministrationShellIdsByAssetLink",
      security: [],
      parameters: [
        {
          name: "limit",
          in: "query",
          required: false,
          description: "Höchstzahl der Ergebnisse auf dieser Seite.",
          schema: { type: "integer", minimum: 1 },
        },
        {
          name: "cursor",
          in: "query",
          required: false,
          description: "Wert aus paging_metadata.cursor der vorigen Antwort.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/AssetLink" } },
            example: [
              { name: "globalAssetId", value: "https://viewer-rc.test.dti.neoception.dev/VNDP77EV202504291" },
            ],
          },
        },
      },
      responses: {
        "200": {
          description: "OK",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PagedResultAasIds" },
              example: {
                paging_metadata: {},
                result: ["https://viewer-rc.test.dti.neoception.dev/aas?itemId=VNDP77EV202504291"],
              },
            },
          },
        },
        "400": {
          description: "Bad Request",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Result" } } },
        },
      },
    },
  };
}

const DISCOVERY_SCHEMAS: Record<string, unknown> = {
  AssetLink: {
    type: "object",
    required: ["name", "value"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 64, example: "globalAssetId" },
      value: {
        type: "string",
        minLength: 1,
        maxLength: 2048,
        example: "https://viewer-rc.test.dti.neoception.dev/VNDP77EV202504291",
      },
    },
  },
  PagingMetadata: {
    type: "object",
    properties: { cursor: { type: "string" } },
  },
  PagedResultAasIds: {
    type: "object",
    properties: {
      paging_metadata: { $ref: "#/components/schemas/PagingMetadata" },
      result: { type: "array", items: { type: "string" } },
    },
  },
  Message: {
    type: "object",
    properties: {
      code: { type: "string" },
      messageType: { type: "string", enum: ["Error", "Warning", "Info", "Exception"] },
      text: { type: "string" },
      timestamp: { type: "string" },
    },
  },
  Result: {
    type: "object",
    properties: { messages: { type: "array", items: { $ref: "#/components/schemas/Message" } } },
  },
};

/**
 * Setzt die Basis um und haengt die Discovery-Operation an. An den Pfaden von
 * oben wird nichts geaendert, das ist die technische Zusage dieses Projekts.
 */
export function zusammenfuehren(oben: OpenApiDokument, proxyBasis: string): OpenApiDokument {
  const dokument = structuredClone(oben);
  dokument.servers = [{ url: proxyBasis }];
  dokument.paths = { ...dokument.paths, [DISCOVERY_PFAD]: discoveryPfad() };
  dokument.components = {
    ...dokument.components,
    schemas: { ...dokument.components?.schemas, ...DISCOVERY_SCHEMAS },
  };
  const tags = dokument.tags ?? [];
  if (!tags.some((tag) => tag.name === "Discovery")) {
    tags.push({ name: "Discovery", description: `Discovery Service Specification V${DISCOVERY_FASSUNG}, SSP-001` });
  }
  dokument.tags = tags;
  return dokument;
}

const CACHE_DAUER_MS = 5 * 60 * 1000;

export class SpecQuelle {
  #holen: typeof fetch;
  /** Je Zielsystem ein Zwischenstand, sonst nimmt ein Proxy die Spec eines anderen. */
  #zwischenstand = new Map<string, { dokument: OpenApiDokument; bis: number }>();

  constructor(holen: typeof fetch = fetch) {
    this.#holen = holen;
  }

  /** Holt die Spec von oben, faellt bei Ausfall auf die mitgelieferte Kopie zurueck. */
  async obenHolen(
    upstreamBasis: string,
    zeitlimitMs: number,
  ): Promise<{ dokument: OpenApiDokument; quelle: "oben" | "kopie" }> {
    const jetzt = Date.now();
    const gemerkt = this.#zwischenstand.get(upstreamBasis);
    if (gemerkt !== undefined && gemerkt.bis > jetzt) {
      return { dokument: gemerkt.dokument, quelle: "oben" };
    }
    try {
      const antwort = await this.#holen(`${upstreamBasis}/swagger/aas/swagger.json`, {
        signal: AbortSignal.timeout(zeitlimitMs),
      });
      if (!antwort.ok) throw new Error(`Status ${antwort.status}`);
      const dokument = (await antwort.json()) as OpenApiDokument;
      if (typeof dokument?.paths !== "object" || dokument.paths === null) {
        throw new Error("Antwort enthaelt kein paths-Objekt");
      }
      this.#zwischenstand.set(upstreamBasis, { dokument, bis: jetzt + CACHE_DAUER_MS });
      return { dokument, quelle: "oben" };
    } catch {
      return { dokument: mitgelieferteSpec(), quelle: "kopie" };
    }
  }

  async dokument(
    upstreamBasis: string,
    zeitlimitMs: number,
    proxyBasis: string,
  ): Promise<{ dokument: OpenApiDokument; quelle: "oben" | "kopie" }> {
    const { dokument, quelle } = await this.obenHolen(upstreamBasis, zeitlimitMs);
    return { dokument: zusammenfuehren(dokument, proxyBasis), quelle };
  }
}
