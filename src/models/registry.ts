import { invalidRequest } from '../openai/errors.js';
import type { ModelListResponse, ModelObject } from '../openai/types.js';

export interface GeminiModelMapping {
  readonly id: string;
  readonly upstreamModelId: string;
  readonly ownedBy: string;
  readonly discovered: boolean;
}

export interface ModelRegistryState {
  readonly models: readonly GeminiModelMapping[];
  readonly degraded: boolean;
  readonly reason?: string;
}

export type ModelDiscovery = () => Promise<readonly GeminiModelMapping[]>;

const FALLBACK_MODEL: GeminiModelMapping = {
  id: 'gemini-web',
  upstreamModelId: 'gemini-web',
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
