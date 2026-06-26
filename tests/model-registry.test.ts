import { describe, expect, it } from 'vitest';
import { OpenAIHttpError } from '../src/openai/errors.js';
import { ModelRegistry, buildModelHeaders } from '../src/models/registry.js';

describe('ModelRegistry', () => {
  it('returns fallback OpenAI-compatible model list when discovery is unavailable', async () => {
    const registry = new ModelRegistry();
    const state = await registry.refresh();
    const response = registry.toOpenAIResponse(1_700_000_000);

    expect(state.degraded).toBe(true);
    expect(response).toEqual({
      object: 'list',
      data: [{ id: 'gemini-web', object: 'model', created: 1_700_000_000, owned_by: 'google' }],
    });
  });

  it('uses discovered models when discovery succeeds', async () => {
    const registry = new ModelRegistry(async () => [
      { id: 'gemini-2.5-pro', upstreamModelId: 'gemini-2.5-pro', modelHeaders: buildModelHeaders('9d8ca3786ebdfbea', 1), ownedBy: 'google', discovered: true },
    ]);

    const state = await registry.refresh();

    expect(state.degraded).toBe(false);
    expect(registry.resolveModel('gemini-2.5-pro').upstreamModelId).toBe('gemini-2.5-pro');
  });

  it('falls back and marks degraded when discovery fails', async () => {
    const registry = new ModelRegistry(async () => {
      throw new Error('upstream unavailable');
    });

    const state = await registry.refresh();

    expect(state.degraded).toBe(true);
    expect(state.reason).toBe('upstream unavailable');
    expect(registry.toOpenAIResponse().data[0]?.id).toBe('gemini-web');
  });

  it('rejects unknown chat models with OpenAI-compatible 400 error', async () => {
    const registry = new ModelRegistry();
    await registry.refresh();

    expect(() => registry.resolveModel('gpt-4')).toThrow(OpenAIHttpError);
    try {
      registry.resolveModel('gpt-4');
      throw new Error('expected model failure');
    } catch (error) {
      if (!(error instanceof OpenAIHttpError)) {
        throw error;
      }
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('model_not_supported');
    }
  });
});
