import { describe, expect, it } from 'vitest';
import { RequestGuard } from '../src/security/request-guard.js';

describe('RequestGuard', () => {
  describe('concurrency limit', () => {
    it('allows up to max concurrent requests per key', () => {
      const guard = new RequestGuard(2, 0, 1000);
      expect(guard.acquire('key-a', 0).allowed).toBe(true);
      expect(guard.acquire('key-a', 0).allowed).toBe(true);
      expect(guard.acquire('key-a', 0).allowed).toBe(false); // 3rd blocked
      guard.release('key-a');
      guard.release('key-a');
    });

    it('releases concurrency slot', () => {
      const guard = new RequestGuard(1, 0, 1000);
      expect(guard.acquire('key-a', 0).allowed).toBe(true);
      guard.release('key-a');
      expect(guard.acquire('key-a', 0).allowed).toBe(true);
      guard.release('key-a');
    });

    it('tracks concurrency per key independently', () => {
      const guard = new RequestGuard(1, 0, 1000);
      expect(guard.acquire('key-a', 0).allowed).toBe(true);
      expect(guard.acquire('key-b', 0).allowed).toBe(true);
      expect(guard.acquire('key-a', 0).allowed).toBe(false);
      guard.release('key-a');
      guard.release('key-b');
    });
  });

  describe('minimum delay', () => {
    it('blocks requests that come too fast', () => {
      const guard = new RequestGuard(5, 1000, 1000);
      expect(guard.acquire('key-a', 0).allowed).toBe(true);
      guard.release('key-a');
      const result = guard.acquire('key-a', 500);
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(429);
      expect(result.error).toContain('Too fast');
    });

    it('allows request after delay window passes', () => {
      const guard = new RequestGuard(5, 1000, 1000);
      expect(guard.acquire('key-a', 0).allowed).toBe(true);
      guard.release('key-a');
      expect(guard.acquire('key-a', 1001).allowed).toBe(true);
      guard.release('key-a');
    });
  });

  describe('daily quota', () => {
    it('blocks requests after daily limit is reached', () => {
      const guard = new RequestGuard(5, 0, 2);
      const t = 1_700_000_000_000;

      expect(guard.acquire('key-a', t).allowed).toBe(true);
      guard.release('key-a');
      expect(guard.acquire('key-a', t + 100).allowed).toBe(true);
      guard.release('key-a');
      expect(guard.acquire('key-a', t + 200).allowed).toBe(false);
    });

    it('resets daily quota on new day', () => {
      const guard = new RequestGuard(5, 0, 2);
      const day1 = new Date('2026-06-26T12:00:00Z').getTime();
      const day2 = new Date('2026-06-27T00:00:01Z').getTime();

      expect(guard.acquire('key-a', day1).allowed).toBe(true);
      guard.release('key-a');
      expect(guard.acquire('key-a', day1 + 100).allowed).toBe(true);
      guard.release('key-a');
      expect(guard.acquire('key-a', day1 + 200).allowed).toBe(false);

      expect(guard.acquire('key-a', day2).allowed).toBe(true);
      guard.release('key-a');
    });
  });

  describe('release handling', () => {
    it('releasing an inactive key does not throw', () => {
      const guard = new RequestGuard(1, 0, 1000);
      expect(() => guard.release('nonexistent')).not.toThrow();
    });
  });

  describe('stats', () => {
    it('reports concurrent count', () => {
      const guard = new RequestGuard(3, 0, 5);

      expect(guard.stats().concurrent).toBe(0);
      guard.acquire('key-a');
      expect(guard.stats().concurrent).toBe(1);
      guard.acquire('key-a');
      expect(guard.stats().concurrent).toBe(2);

      guard.release('key-a');
      guard.release('key-a');
      expect(guard.stats().concurrent).toBe(0);
    });
  });
});
