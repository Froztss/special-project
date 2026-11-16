import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app.js';
import { createAccessToken } from '../lib/auth.js';
import { aliceUser } from '../test-utils/auth.js';

describe('JWT authentication', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns only the current user fields for a valid signed token', async () => {
    const token = createAccessToken(aliceUser);
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(aliceUser);
  });

  it.each([
    undefined,
    'Bearer forged.token.value',
    'Bearer 1',
    'Basic token',
  ])('rejects missing or invalid credentials: %s', async (authorization) => {
    const req = request(app).get('/api/auth/me');
    if (authorization) {
      req.set('Authorization', authorization);
    }

    const response = await req;
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: expect.any(String) });
  });

  it('rejects expired signed tokens', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const token = createAccessToken(aliceUser);
    vi.setSystemTime(new Date('2026-01-01T09:00:00.000Z'));

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid or expired token');
  });
});
