import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const TEST_API_KEY = 'test-api-key-that-is-at-least-32-characters-long';

describe('authPlugin', () => {
  describe('when API_KEY is set', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      vi.doMock('../../src/config/env.js', () => ({
        env: { API_KEY: TEST_API_KEY },
      }));

      const { authPlugin } = await import('../../src/plugins/auth.js');

      app = Fastify({ logger: false });
      await app.register(authPlugin);
      app.get('/test', async () => ({ ok: true }));
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      vi.restoreAllMocks();
    });

    it('returns 401 when x-api-key header is missing', async () => {
      const response = await app.inject({ method: 'GET', url: '/test' });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ statusCode: 401, error: 'Unauthorized' });
    });

    it('returns 401 when x-api-key header is wrong', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-api-key': 'wrong-key-but-still-at-least-32-chars!!' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('passes through when x-api-key header is correct', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-api-key': TEST_API_KEY },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    });

    it('returns 401 for an empty x-api-key header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-api-key': '' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 401 for a wrong key of the same length (timing-safe compare path)', async () => {
      // Same length as the real key, so the length guard passes and
      // timingSafeEqual itself must reject the content.
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-api-key': 'x'.repeat(TEST_API_KEY.length) },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('when API_KEY is not set', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      vi.resetModules();
      vi.doMock('../../src/config/env.js', () => ({
        env: { API_KEY: undefined },
      }));

      const { authPlugin } = await import('../../src/plugins/auth.js');

      app = Fastify({ logger: false });
      await app.register(authPlugin);
      app.get('/test', async () => ({ ok: true }));
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      vi.restoreAllMocks();
    });

    it('allows requests without x-api-key header', async () => {
      const response = await app.inject({ method: 'GET', url: '/test' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    });
  });
});
