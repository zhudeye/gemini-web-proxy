import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createServer } from '../src/server.js';

let server: Server | undefined;

function closeServer(instance: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    instance.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function startTestServer(): Promise<string> {
  server = createServer();
  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server !== undefined) {
    await closeServer(server);
    server = undefined;
  }
});

describe('streaming chat completions route', () => {
  it('returns OpenAI-compatible SSE chunks and DONE terminator', async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gemini-3.5-flash', messages: [{ role: 'user', content: 'Stream hello' }], stream: true }),
    });

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('content-length')).toBeNull();
    expect(text).toContain('data: {');
    expect(text).toContain('chat.completion.chunk');
    expect(text).toContain('Mock Gemini response to: Stream hello');
    expect(text.trimEnd()).toMatch(/data: \[DONE\]$/);
  });
});
