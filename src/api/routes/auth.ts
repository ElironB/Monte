import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../plugins/auth.js';
import { runQuery, runQuerySingle, runWriteSingle } from '../../config/neo4j.js';
import { AuthenticationError, ConflictError } from '../../utils/errors.js';
import { v4 as uuidv4 } from 'uuid';

const SALT_ROUNDS = 12;

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', {
    schema: {
      description: 'Register new user',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email', 'password', 'name'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          name: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const body = registerSchema.parse(request.body);
      
      const existing = await runQuerySingle<{ id: string }>(
        'MATCH (u:User {email: $email}) RETURN u.id as id',
        { email: body.email }
      );
      if (existing) throw new ConflictError('Email already registered');
      
      const userId = uuidv4();
      const passwordHash = await bcrypt.hash(body.password, SALT_ROUNDS);
      
      await runWriteSingle(
        `CREATE (u:User {
          id: $userId,
          email: $email,
          passwordHash: $passwordHash,
          name: $name,
          createdAt: datetime(),
          updatedAt: datetime()
        }) RETURN u.id as id`,
        { userId, email: body.email, passwordHash, name: body.name }
      );
      
      const accessToken = generateAccessToken({ userId, email: body.email });
      const refreshToken = generateRefreshToken({ userId, email: body.email });
      
      reply.status(201);
      return { userId, email: body.email, name: body.name, accessToken, refreshToken };
    },
  });

  fastify.post('/login', {
    schema: { description: 'Login', tags: ['auth'] },
    handler: async (request) => {
      const body = loginSchema.parse(request.body);
      
      const user = await runQuerySingle<{
        id: string;
        email: string;
        passwordHash: string;
        name: string;
      }>(
        'MATCH (u:User {email: $email}) RETURN u.id as id, u.email as email, u.passwordHash as passwordHash, u.name as name',
        { email: body.email }
      );
      
      if (!user) throw new AuthenticationError('Invalid credentials');
      
      const valid = await bcrypt.compare(body.password, user.passwordHash);
      if (!valid) throw new AuthenticationError('Invalid credentials');
      
      const accessToken = generateAccessToken({ userId: user.id, email: user.email });
      const refreshToken = generateRefreshToken({ userId: user.id, email: user.email });
      
      return { userId: user.id, email: user.email, name: user.name, accessToken, refreshToken };
    },
  });

  fastify.post('/refresh', {
    schema: { description: 'Refresh token', tags: ['auth'] },
    handler: async (request) => {
      const body = refreshSchema.parse(request.body);
      const payload = verifyRefreshToken(body.refreshToken);
      
      if (payload.type !== 'refresh') throw new AuthenticationError('Invalid token type');
      
      const accessToken = generateAccessToken({ userId: payload.userId, email: payload.email });
      const refreshToken = generateRefreshToken({ userId: payload.userId, email: payload.email });
      
      return { accessToken, refreshToken };
    },
  });

  fastify.get('/me', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Get current user', tags: ['auth'], security: [{ bearerAuth: [] }] },
    handler: async (request) => {
      const user = await runQuerySingle<{
        id: string;
        email: string;
        name: string;
        createdAt: string;
      }>(
        'MATCH (u:User {id: $userId}) RETURN u.id as id, u.email as email, u.name as name, u.createdAt as createdAt',
        { userId: request.user.userId }
      );
      if (!user) throw new AuthenticationError('User not found');
      
      const persona = await runQuerySingle<{ status: string }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)
         RETURN p.buildStatus as status ORDER BY p.version DESC LIMIT 1`,
        { userId: request.user.userId }
      );
      
      return { ...user, personaStatus: persona?.status ?? 'none' };
    },
  });
}

export default authRoutes;
