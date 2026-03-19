import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { AuthenticationError } from '../../utils/errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: { userId: string; email: string; iat: number; exp: number; scopes?: string[] };
  }
}

export interface TokenPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
}

export function generateAccessToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, config.auth.jwtSecret, {
    expiresIn: `${config.auth.jwtExpiryMinutes}m`,
  });
}

export function generateRefreshToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'refresh' }, config.auth.refreshTokenSecret, {
    expiresIn: `${config.auth.refreshTokenExpiryDays}d`,
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, config.auth.jwtSecret) as TokenPayload;
  } catch {
    throw new AuthenticationError('Invalid access token');
  }
}

export function verifyRefreshToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, config.auth.refreshTokenSecret) as TokenPayload;
  } catch {
    throw new AuthenticationError('Invalid refresh token');
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Missing token', code: 'AUTHENTICATION_ERROR' });
      throw new AuthenticationError();
    }
    
    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);
    if (payload.type !== 'access') {
      reply.status(401).send({ error: 'Invalid token type', code: 'AUTHENTICATION_ERROR' });
      throw new AuthenticationError();
    }
    
    request.user = {
      userId: payload.userId,
      email: payload.email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + config.auth.jwtExpiryMinutes * 60,
    };
  });
};

export default fp(authPlugin, { name: 'auth' });
