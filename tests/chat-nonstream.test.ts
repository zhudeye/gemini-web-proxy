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

async function postChat(baseUrl: string, content: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gemini-3.5-flash', messages: [{ role: 'user', content }] }),
  });
}

describe('non-streaming chat completions route', () => {
  it('returns an OpenAI-compatible non-streaming response', async () => {
    const baseUrl = await startTestServer();
    const response = await postChat(baseUrl, 'Say hello');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      object: 'chat.completion',
      model: 'gemini-3.5-flash',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Mock Gemini response to: Say hello' } }],
    });
  });

  it('keeps requests stateless', async () => {
    const baseUrl = await startTestServer();
    await postChat(baseUrl, 'First');
    // Wait for RequestGuard's min delay window (default 1500ms)
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    const response = await postChat(baseUrl, 'Second');
    const body = await response.json();
    const content = body.choices[0].message.content as string;

    expect(content).toContain('Second');
    expect(content).not.toContain('First');
  });
});
