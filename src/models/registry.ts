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

/**
 * Build model-specific HTTP headers for the StreamGenerate endpoint.
 *
 * The `modelHex` identifies the model to Gemini's server (e.g. "fbb127bbb056c959").
 * The `capacityTail` controls feature tier (1=basic, 2=advanced, 4=plus).
 */
export function buildModelHeaders(modelHex: string, capacityTail = 1): Record<string, string> {
  return {
    'x-goog-ext-525001261-jspb': JSON.stringify([1, null, null, null, modelHex, null, null, 0, [4], null, null, capacityTail]),
    'x-goog-ext-73010989-jspb': '[0]',
    'x-goog-ext-73010990-jspb': '[0]',
  };
}

// Mapping: upstream model ID → hex string for x-goog-ext-525001261-jspb
const MODEL_HEX: Record<string, string> = {
  'gemini-2.0-flash-exp': 'fbb127bbb056c959',
  'gemini-2.5-flash': '35609594dbe934d8',
  'gemini-2.5-pro': '2525e3954d185b3c',
};

const FALLBACK_MODEL: GeminiModelMapping = {
  id: 'gemini-web',
  upstreamModelId: 'gemini-2.0-flash-exp',
  modelHeaders: buildModelHeaders('fbb127bbb056c959', 1),
  ownedBy: 'google',
  discovered: false,
};

export class ModelRegistry {
  private state: ModelRegistryState = {
    models: [FALLBACK_MODEL],
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
        models: [FALLBACK_MODEL],
        degraded: true,
        reason: 'model_discovery_unavailable',
      };
      return this.state;
    }

    try {
      const discoveredModels = await this.discovery();
      if (discoveredModels.length === 0) {
        this.state = {
          models: [FALLBACK_MODEL],
          degraded: true,
          reason: 'model_discovery_empty',
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
        models: [FALLBACK_MODEL],
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

/** Create a GeminiModelMapping from an upstream model ID. */
export function createModelMapping(
  id: string,
  upstreamModelId: string,
  discovered = false,
): GeminiModelMapping {
  const modelHex = MODEL_HEX[upstreamModelId];
  return {
    id,
    upstreamModelId,
    modelHeaders: modelHex ? buildModelHeaders(modelHex, 1) : FALLBACK_MODEL.modelHeaders,
    ownedBy: 'google',
    discovered,
  };
}
