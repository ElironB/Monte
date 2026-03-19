import { describe, it, expect } from 'vitest';
import { generateAccessToken, verifyAccessToken, generateRefreshToken, verifyRefreshToken } from '../src/api/plugins/auth.js';

describe('Auth', () => {
  const payload = { userId: 'test-123', email: 'test@example.com' };

  it('generates and verifies access token', () => {
    const token = generateAccessToken(payload);
    const verified = verifyAccessToken(token);
    expect(verified.userId).toBe(payload.userId);
    expect(verified.type).toBe('access');
  });

  it('generates and verifies refresh token', () => {
    const token = generateRefreshToken(payload);
    const verified = verifyRefreshToken(token);
    expect(verified.userId).toBe(payload.userId);
    expect(verified.type).toBe('refresh');
  });
});
