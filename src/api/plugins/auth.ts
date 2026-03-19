import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

const LOCAL_USER_ID = 'local-user';
const LOCAL_USER_EMAIL = 'local@monte.localhost';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: { userId: string; email: string; iat: number; exp: number; scopes?: string[] };
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    // Self-hosted mode: no auth required, inject local user
    request.user = {
      userId: LOCAL_USER_ID,
      email: LOCAL_USER_EMAIL,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    };
  });
};

export default fp(authPlugin, { name: 'auth' });
