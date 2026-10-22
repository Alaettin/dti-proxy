import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DISCOVERY_PFAD, REGISTRY_PFAD, SHELLS_PFAD, SUBMODEL_REGISTRY_PFAD } from "./pfade.js";
import { DISCOVERY_FASSUNG, DISCOVERY_PROFIL } from "./routen/discovery.js";
import { ASSET_KINDS, REGISTRY_FASSUNG, REGISTRY_PROFIL } from "./routen/registry.js";
import { SUBMODEL_REGISTRY_FASSUNG, SUBMODEL_REGISTRY_PROFIL } from "./routen/submodelRegistry.js";
import { REPOSITORY_FASSUNG, REPOSITORY_PROFIL, SEITE_VORGABE } from "./routen/shells.js";

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

const REGISTRY_TAG = "AssetAdministrationShellRegistry";

function registryAntworten(): Record<string, unknown> {
  return {
    "400": {
      description: "Bad Request",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Result" } } },
    },
    "401": { description: "Unauthorized, unverändert vom Zielsystem" },
    "403": { description: "Forbidden, unverändert vom Zielsystem" },
    "502": {
      description: "Das Zielsystem antwortet nicht oder unerwartet",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Result" } } },
    },
  };
}

function registryPfade(): Record<string, unknown> {
  const hinweis =
    `Asset Administration Shell Registry Service Specification V${REGISTRY_FASSUNG}, Profil SSP-002 (${REGISTRY_PROFIL}). ` +
    `Registriert sind die Item-IDs, die für diesen Proxy gepflegt sind. Die Descriptoren entstehen aus den Schalen ` +
    `des Zielsystems (gepuffert wie GET /shells), ihre Endpunkte zeigen auf diesen Proxy.`;
  return {
    [REGISTRY_PFAD]: {
      get: {
        tags: [REGISTRY_TAG],
        summary: "GetAllAssetAdministrationShellDescriptors",
        description: `${hinweis} Ohne limit enthält eine Seite höchstens ${SEITE_VORGABE} Descriptoren.`,
        operationId: "GetAllAssetAdministrationShellDescriptors",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Höchstzahl der Descriptoren auf dieser Seite.",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            description: "Wert aus paging_metadata.cursor der vorigen Antwort.",
            schema: { type: "string" },
          },
          {
            name: "assetKind",
            in: "query",
            required: false,
            description: "Art des Assets.",
            schema: { type: "string", enum: [...ASSET_KINDS] },
          },
          {
            name: "assetType",
            in: "query",
            required: false,
            description: "Typ des Assets (UTF8-BASE64-URL-kodiert).",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Requested Asset Administration Shell Descriptors",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GetAssetAdministrationShellDescriptorsResult" },
              },
            },
          },
          ...registryAntworten(),
        },
      },
    },
    [`${REGISTRY_PFAD}/{aasIdentifier}`]: {
      get: {
        tags: [REGISTRY_TAG],
        summary: "GetAssetAdministrationShellDescriptorById",
        description: hinweis,
        operationId: "GetAssetAdministrationShellDescriptorById",
        parameters: [
          {
            name: "aasIdentifier",
            in: "path",
            required: true,
            description: "Die Kennung der Verwaltungsschale (UTF8-BASE64-URL-kodiert).",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Requested Asset Administration Shell Descriptor",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AssetAdministrationShellDescriptor" } },
            },
          },
          "404": {
            description: "Not Found",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Result" } } },
          },
          ...registryAntworten(),
        },
      },
    },
  };
}

/**
 * Vereinfacht nach Part2-API-Schemas V3.1.3; Teile aus dem Metamodell stehen
 * als object. Eine Funktion statt einer Konstante: registry.ts haengt ueber
 * swagger.ts an dieser Datei, beim Laden ist ASSET_KINDS womoeglich noch nicht da.
 */
function registrySchemas(): Record<string, unknown> {
  return {
    ProtocolInformation: {
      type: "object",
      required: ["href"],
      properties: {
        href: { type: "string", maxLength: 2048 },
        endpointProtocol: { type: "string", maxLength: 128 },
        endpointProtocolVersion: { type: "array", items: { type: "string", maxLength: 128 } },
      },
    },
    Endpoint: {
      type: "object",
      required: ["protocolInformation", "interface"],
      properties: {
        interface: { type: "string", maxLength: 128 },
        protocolInformation: { $ref: "#/components/schemas/ProtocolInformation" },
      },
    },
    SubmodelDescriptor: {
      type: "object",
      required: ["id", "endpoints"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 2048 },
        semanticId: { type: "object" },
        endpoints: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/Endpoint" } },
      },
    },
    AssetAdministrationShellDescriptor: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 2048 },
        idShort: { type: "string", minLength: 1, maxLength: 128 },
        administration: { type: "object" },
        description: { type: "array", items: { type: "object" } },
        displayName: { type: "array", items: { type: "object" } },
        assetKind: { type: "string", enum: [...ASSET_KINDS] },
        assetType: { type: "string", minLength: 1, maxLength: 2048 },
        globalAssetId: { type: "string", minLength: 1, maxLength: 2048 },
        specificAssetIds: { type: "array", items: { type: "object" } },
        endpoints: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/Endpoint" } },
        submodelDescriptors: { type: "array", items: { $ref: "#/components/schemas/SubmodelDescriptor" } },
      },
    },
    GetAssetAdministrationShellDescriptorsResult: {
      type: "object",
      required: ["paging_metadata"],
      properties: {
        paging_metadata: { $ref: "#/components/schemas/PagingMetadata" },
        result: { type: "array", items: { $ref: "#/components/schemas/AssetAdministrationShellDescriptor" } },
      },
    },
  };
}

const SUBMODEL_REGISTRY_TAG = "SubmodelRegistry";

function submodelRegistryPfade(): Record<string, unknown> {
  const hinweis =
    `Submodel Registry Service Specification V${SUBMODEL_REGISTRY_FASSUNG}, Profil SSP-002 (${SUBMODEL_REGISTRY_PROFIL}). ` +
    `Registriert sind die Teilmodelle, auf die die Schalen der gepflegten Item-IDs verweisen. Die Descriptoren ` +
    `entstehen aus diesen Verweisen (gepuffert wie GET /shells), ihre Endpunkte zeigen auf diesen Proxy.`;
  return {
    [SUBMODEL_REGISTRY_PFAD]: {
      get: {
        tags: [SUBMODEL_REGISTRY_TAG],
        summary: "GetAllSubmodelDescriptors",
        description: `${hinweis} Ohne limit enthält eine Seite höchstens ${SEITE_VORGABE} Descriptoren.`,
        operationId: "GetAllSubmodelDescriptors",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Höchstzahl der Descriptoren auf dieser Seite.",
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
        responses: {
          "200": {
            description: "Requested Submodel Descriptors",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/GetSubmodelDescriptorsResult" } },
            },
          },
          ...registryAntworten(),
        },
      },
    },
    [`${SUBMODEL_REGISTRY_PFAD}/{submodelIdentifier}`]: {
      get: {
        tags: [SUBMODEL_REGISTRY_TAG],
        summary: "GetSubmodelDescriptorById",
        description: hinweis,
        operationId: "GetSubmodelDescriptorById",
        parameters: [
          {
            name: "submodelIdentifier",
            in: "path",
            required: true,
            description: "Die Kennung des Teilmodells (UTF8-BASE64-URL-kodiert).",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Requested Submodel Descriptor",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SubmodelDescriptor" } } },
          },
          "404": {
            description: "Not Found",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Result" } } },
          },
          ...registryAntworten(),
        },
      },
    },
  };
}

/** Was die Submodel Registry braucht; die Teile sind dieselben wie in der AAS Registry. */
function submodelRegistrySchemas(): Record<string, unknown> {
  const geteilt = registrySchemas();
  return {
    ProtocolInformation: geteilt.ProtocolInformation,
    Endpoint: geteilt.Endpoint,
    SubmodelDescriptor: geteilt.SubmodelDescriptor,
    GetSubmodelDescriptorsResult: {
      type: "object",
      required: ["paging_metadata"],
      properties: {
        paging_metadata: { $ref: "#/components/schemas/PagingMetadata" },
        result: { type: "array", items: { $ref: "#/components/schemas/SubmodelDescriptor" } },
      },
    },
  };
}

function shellsPfad(): Record<string, unknown> {
  return {
    get: {
      tags: ["AssetAdministrationShellRepository"],
      summary: "GetAllAssetAdministrationShells",
      description:
        `Liefert die Asset Administration Shells zu den Item-IDs, die für diesen Proxy gepflegt sind. ` +
        `Asset Administration Shell Repository Service Specification V${REPOSITORY_FASSUNG}, Profil SSP-002 (${REPOSITORY_PROFIL}). ` +
        `Die Schalen werden vom Zielsystem geholt und je nach Einstellung des Proxys eine Zeit lang gepuffert. ` +
        `In assetIds wird ausschließlich der Name globalAssetId ausgewertet, mehrere Werte sind oder-verknüpft. ` +
        `Ohne limit enthält eine Seite höchstens ${SEITE_VORGABE} Schalen.`,
      operationId: "GetAllAssetAdministrationShells",
      parameters: [
        {
          name: "assetIds",
          in: "query",
          required: false,
          style: "form",
          explode: true,
          description: "Je Wert eine base64url-kodierte SpecificAssetId, etwa {\"name\":\"globalAssetId\",\"value\":\"…\"}.",
          schema: { type: "array", items: { type: "string" } },
        },
        {
          name: "limit",
          in: "query",
          required: false,
          description: "Höchstzahl der Schalen auf dieser Seite.",
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
      responses: {
        "200": {
          description: "Requested Asset Administration Shells",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/GetAssetAdministrationShellsResult" } },
          },
        },
        "400": {
          description: "Bad Request",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Result" } } },
        },
        "401": { description: "Unauthorized, unverändert vom Zielsystem" },
        "403": { description: "Forbidden, unverändert vom Zielsystem" },
        "502": {
          description: "Das Zielsystem antwortet nicht oder unerwartet",
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
  GetAssetAdministrationShellsResult: {
    type: "object",
    required: ["paging_metadata"],
    properties: {
      paging_metadata: { $ref: "#/components/schemas/PagingMetadata" },
      // Das Zielsystem liefert kein Schema der Schale mit, deshalb nur object.
      result: { type: "array", items: { type: "object" } },
    },
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
 * Setzt die Basis um und haengt GET /shells und die Discovery-Operation an. An den Pfaden von
 * oben wird nichts geaendert, das ist die technische Zusage dieses Projekts.
 */
export function zusammenfuehren(
  oben: OpenApiDokument,
  proxyBasis: string,
  { shells = false, registry = false, submodelRegistry = false }: EigeneWege = {},
): OpenApiDokument {
  const dokument = structuredClone(oben);
  dokument.servers = [{ url: proxyBasis }];
  // GET /shells und die Registries nur, wenn der Proxy sie anbietet: sonst
  // verspraeche die Seite Wege, die 404 geben.
  dokument.paths = {
    ...dokument.paths,
    ...(shells ? { [SHELLS_PFAD]: shellsPfad() } : {}),
    ...(registry ? registryPfade() : {}),
    ...(submodelRegistry ? submodelRegistryPfade() : {}),
    [DISCOVERY_PFAD]: discoveryPfad(),
  };
  dokument.components = {
    ...dokument.components,
    schemas: {
      ...dokument.components?.schemas,
      ...DISCOVERY_SCHEMAS,
      ...(registry ? registrySchemas() : {}),
      ...(submodelRegistry ? submodelRegistrySchemas() : {}),
    },
  };
  const tags = dokument.tags ?? [];
  if (!tags.some((tag) => tag.name === "Discovery")) {
    tags.push({ name: "Discovery", description: `Discovery Service Specification V${DISCOVERY_FASSUNG}, SSP-001` });
  }
  if (registry && !tags.some((tag) => tag.name === REGISTRY_TAG)) {
    tags.push({
      name: REGISTRY_TAG,
      description: `Asset Administration Shell Registry Service Specification V${REGISTRY_FASSUNG}, SSP-002`,
    });
  }
  if (submodelRegistry && !tags.some((tag) => tag.name === SUBMODEL_REGISTRY_TAG)) {
    tags.push({
      name: SUBMODEL_REGISTRY_TAG,
      description: `Submodel Registry Service Specification V${SUBMODEL_REGISTRY_FASSUNG}, SSP-002`,
    });
  }
  dokument.tags = tags;
  return dokument;
}

/** Welche der eigenen Wege ein Proxy anbietet. */
export interface EigeneWege {
  shells?: boolean;
  registry?: boolean;
  submodelRegistry?: boolean;
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
    optionen: EigeneWege = {},
  ): Promise<{ dokument: OpenApiDokument; quelle: "oben" | "kopie" }> {
    const { dokument, quelle } = await this.obenHolen(upstreamBasis, zeitlimitMs);
    return { dokument: zusammenfuehren(dokument, proxyBasis, optionen), quelle };
  }
}
