import type { Hub } from './ws/hub.js';

declare module 'fastify' {
  interface FastifyInstance {
    hub: Hub;
  }
}