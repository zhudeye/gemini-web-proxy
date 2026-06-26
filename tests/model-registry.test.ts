import { describe, expect, it } from 'vitest';
import { OpenAIHttpError } from '../src/openai/errors.js';
import { ModelRegistry, buildModelHeaders } from '../src/models/registry.js';

describe('ModelRegistry', () => {
  it('returns built-in model list when discovery is unavailable', async () => {
    const registry = new ModelRegistry();
    const state = await registry.refresh();
    const response = registry.toOpenAIResponse(1_700_000_000);

    // Without discovery, registry returns built-in models and is not degraded
    expect(state.degraded).toBe(false);
    expect(state.reason).toBeUndefined();
    expect(response.object).toBe('list');
    // Expect the known built-in models
    const modelIds = response.data.map((m) => m.id);
    expect(modelIds).toContain('gemini-3.5-flash');
    expect(modelIds).toContain('gemini-3.5-thinking');
    expect(modelIds).toContain('gemini-3.1-pro');
    expect(modelIds).toContain('gemini-3.1-flash-lite');
  });

  it('uses discovered models when discovery succeeds', async () => {
    const registry = new ModelRegistry(async () => [
      {
        id: 'gemini-custom',
        upstreamModelId: 'gemini-custom',
        modelHeaders: buildModelHeaders('9d8ca3786ebdfbea', 1, 1),
        ownedBy: 'google',
        discovered: true,
      },
    ]);

    const state = await registry.refresh();

    expect(state.degraded).toBe(false);
    expect(registry.resolveModel('gemini-custom').upstreamModelId).toBe('gemini-custom');
  });

  it('falls back to built-in models when discovery fails', async () => {
    const registry = new ModelRegistry(async () => {
      throw new Error('upstream unavailable');
    });

    const state = await registry.refresh();

    expect(state.degraded).toBe(true);
    expect(state.reason).toBe('upstream unavailable');

    // Fallback should include the built-in models
    const modelIds = registry.toOpenAIResponse().data.map((m) => m.id);
    expect(modelIds).toContain('gemini-3.5-flash');
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

  it('accepts any of the built-in model names', async () => {
    const registry = new ModelRegistry();
    await registry.refresh();

    expect(() => registry.resolveModel('gemini-3.5-flash')).not.toThrow();
    expect(() => registry.resolveModel('gemini-3.5-thinking')).not.toThrow();
    expect(() => registry.resolveModel('gemini-3.1-pro')).not.toThrow();
    expect(() => registry.resolveModel('gemini-3.1-flash-lite')).not.toThrow();
  });
});
