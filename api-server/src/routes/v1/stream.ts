import type { FastifyInstance } from 'fastify';
import type { Hub } from '../ws/hub.js';
import type { WhaleFilter } from '../shared/types.js';

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  filter?: WhaleFilter;
}

function getClientIp(request: unknown): string {
  const req = request as { ip?: string; headers?: { [key: string]: string | string[] | undefined } };
  if (req.ip) return req.ip;
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  if (Array.isArray(forwarded)) return String(forwarded[0]).split(',')[0].trim();
  return 'unknown';
}

export async function registerStreamRoute(fastify: FastifyInstance) {
  fastify.get('/', { websocket: true }, (socket, request) => {
    const hub: Hub = (fastify as any).hub;
    const ip = getClientIp(request);
    let filter: WhaleFilter = {};

    const connId = hub.add(socket, filter, null, ip);
    if (!connId) return;

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;

        switch (msg.type) {
          case 'subscribe':
            if (msg.filter) {
              filter = msg.filter;
              hub.updateFilter(connId, filter);
            }
            break;
          case 'unsubscribe':
            filter = {};
            hub.updateFilter(connId, filter);
            break;
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' }));
            break;
        }
        if (!hub.onClientMessage(connId)) return;
      } catch {
        socket.send(JSON.stringify({ type: 'error', code: 'BAD_MESSAGE', message: 'invalid JSON' }));
      }
    });

    socket.on('close', () => {
      hub.remove(connId);
    });

    socket.send(JSON.stringify({ type: 'hello', serverTime: Math.floor(Date.now() / 1000) }));

    const heartbeat = setInterval(() => {
      socket.send(JSON.stringify({ type: 'pong' }));
    }, 20000);

    socket.on('close', () => clearInterval(heartbeat));
  });
}