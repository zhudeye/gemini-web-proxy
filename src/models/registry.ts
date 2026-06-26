import crypto from 'node:crypto';
import { invalidRequest } from '../openai/errors.js';
import type { ModelListResponse, ModelObject } from '../openai/types.js';

export interface GeminiModelMapping {
  readonly id: string;
  readonly upstreamModelId: string;
  readonly modelHeaders: Readonly<Record<string, string>>;
  readonly ownedBy: string;
  readonly discovered: boolean;
}

export interface ModelRegistryState {
  readonly models: readonly GeminiModelMapping[];
  readonly degraded: boolean;
  readonly reason?: string;
}

export type ModelDiscovery = () => Promise<readonly GeminiModelMapping[]>;

// Stable device UUID — generated once at startup, reused across all model headers.
const DEVICE_UUID = crypto.randomUUID().toUpperCase();

/**
 * Build model-specific HTTP headers for the StreamGenerate endpoint.
 *
 * Current Gemini Web header format (as of mid-2026):
 *   [1, null, null, null, "<modelHex>", null, null, 1, [4,5,6,8], null, null, 2, null, null, <tier>, <thinking>, "<deviceUUID>"]
 *
 * @param modelHex - Internal hex identifier for the model (e.g. "56fdd199312815e2").
 * @param capacityTier - Feature tier: 1=flash, 3=pro, 6=flash-lite.
 * @param thinkingLevel - 1=standard, 2=extended thinking.
 */
export function buildModelHeaders(modelHex: string, capacityTier = 1, thinkingLevel = 1): Record<string, string> {
  return {
    'x-goog-ext-525001261-jspb': JSON.stringify([1, null, null, null, modelHex, null, null, 1, [4, 5, 6, 8], null, null, 2, null, null, capacityTier, thinkingLevel, DEVICE_UUID]),
    'x-goog-ext-73010989-jspb': '[0]',
    'x-goog-ext-73010990-jspb': '[0,0,0]',
  };
}

// Internal model configuration: hex ID, capacity tier, and default thinking level.
interface ModelConfig {
  readonly hex: string;
  readonly capacity: number;
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // Legacy models (kept for backward compatibility)
  'gemini-2.0-flash-exp': { hex: 'fbb127bbb056c959', capacity: 1 },
  'gemini-2.5-flash':     { hex: '35609594dbe934d8', capacity: 1 },
  'gemini-2.5-pro':       { hex: '2525e3954d185b3c', capacity: 2 },
  // Current models (as of mid-2026)
  'gemini-3.5-flash':     { hex: '56fdd199312815e2', capacity: 1 },
  'gemini-3.1-pro':       { hex: 'e6fa609c3fa255c0', capacity: 3 },
  'gemini-3.1-flash-lite': { hex: '8c46e95b1a07cecc', capacity: 6 },
};

/** Built-in model entries shipped with the proxy. */
const BUILTIN_MODELS: readonly GeminiModelMapping[] = [
  // Current models — displayed to users in Cherry Studio
  {
    id: 'gemini-3.5-flash',
    upstreamModelId: 'gemini-3.5-flash',
    modelHeaders: buildModelHeaders('56fdd199312815e2', 1, 1),
    ownedBy: 'google',
    discovered: false,
  },
  {
    id: 'gemini-3.5-thinking',
    upstreamModelId: 'gemini-3.5-flash',       // same base model
    modelHeaders: buildModelHeaders('56fdd199312815e2', 1, 2),  // extended thinking
    ownedBy: 'google',
    discovered: false,
  },
  {
    id: 'gemini-3.1-pro',
    upstreamModelId: 'gemini-3.1-pro',
    modelHeaders: buildModelHeaders('e6fa609c3fa255c0', 3, 1),
    ownedBy: 'google',
    discovered: false,
  },
  {
    id: 'gemini-3.1-flash-lite',
    upstreamModelId: 'gemini-3.1-flash-lite',
    modelHeaders: buildModelHeaders('8c46e95b1a07cecc', 6, 1),
    ownedBy: 'google',
    discovered: false,
  },
];

const FALLBACK_MODEL: GeminiModelMapping = BUILTIN_MODELS[0]; // gemini-3.5-flash

/**
 * Build a GeminiModelMapping from its upstream model ID and optional alias.
 */
export function createModelMapping(
  id: string,
  upstreamModelId: string,
  discovered = false,
): GeminiModelMapping {
  const config = MODEL_CONFIGS[upstreamModelId];
  if (config !== undefined) {
    return {
      id,
      upstreamModelId,
      modelHeaders: buildModelHeaders(config.hex, config.capacity),
      ownedBy: 'google',
      discovered,
    };
  }

  // Unknown upstream — fall back to default model headers
  return {
    id,
    upstreamModelId,
    modelHeaders: FALLBACK_MODEL.modelHeaders,
    ownedBy: 'google',
    discovered,
  };
}

export class ModelRegistry {
  private state: ModelRegistryState = {
    models: [...BUILTIN_MODELS],
    degraded: true,
    reason: 'model_discovery_not_run',
  };

  constructor(private readonly discovery?: ModelDiscovery) {}

  getState(): ModelRegistryState {
    return this.state;
  }

  async refresh(): Promise<ModelRegistryState> {
    if (this.discovery === undefined) {
      this.state = {
        models: [...BUILTIN_MODELS],
        degraded: false,
        reason: undefined,
      };
      return this.state;
    }

    try {
      const discoveredModels = await this.discovery();
      if (discoveredModels.length === 0) {
        this.state = {
          models: [...BUILTIN_MODELS],
          degraded: false,
        };
        return this.state;
      }

      this.state = {
        models: discoveredModels,
        degraded: false,
      };
      return this.state;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'model_discovery_failed';
      this.state = {
        models: [...BUILTIN_MODELS],
        degraded: true,
        reason,
      };
      return this.state;
    }
  }

  resolveModel(modelId: string): GeminiModelMapping {
    const model = this.state.models.find((candidate) => candidate.id === modelId);
    if (model === undefined) {
      throw invalidRequest(`Model is not supported: ${modelId}`, 'model_not_supported', 'model');
    }

    return model;
  }

  toOpenAIResponse(nowSeconds = Math.floor(Date.now() / 1000)): ModelListResponse {
    return {
      object: 'list',
      data: this.state.models.map((model): ModelObject => ({
        id: model.id,
        object: 'model',
        created: nowSeconds,
        owned_by: model.ownedBy,
      })),
    };
  }
}

export function createFallbackModelRegistry(): ModelRegistry {
  return new ModelRegistry();
}
