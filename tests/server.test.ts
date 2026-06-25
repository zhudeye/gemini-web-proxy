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

describe('native HTTP server health routes', () => {
  it('returns health JSON', async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'gemini-web' });
  });

  it('returns readiness JSON', async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/health/ready`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ready', service: 'gemini-web', degraded: false });
  });

  it('returns controlled 404 JSON', async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/not-found`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: { code: 'not_found' } });
  });

  it('returns controlled 405 JSON', async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/health`, { method: 'POST' });
    const body = await response.json();

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(body).toMatchObject({ error: { code: 'method_not_allowed' } });
  });
});
