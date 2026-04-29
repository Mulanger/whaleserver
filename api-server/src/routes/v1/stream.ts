import type { FastifyInstance } from 'fastify';
import type { Hub } from '../../ws/hub.js';
import type { WhaleFilter } from '../../shared/types.js';
import { verifyToken, extractUserId } from '../../auth/jwt.js';
import { getFollowedWallets } from '../../db/repos/follows_repo.js';

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
    let userId: string | null = null;

    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = verifyToken(fastify, authHeader.slice(7));
        userId = extractUserId(payload);
      } catch {
        // ignore invalid optional auth for socket establishment
      }
    }

    const connId = hub.add(socket, filter, userId, ip);
    if (!connId) return;

    socket.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;

        switch (msg.type) {
          case 'subscribe':
            if (msg.filter) {
              if (msg.filter.following === true) {
                if (!userId) {
                  socket.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'auth required for following filter' }));
                  break;
                }

                const followedWallets = await getFollowedWallets(userId, 500);
                filter = {
                  ...msg.filter,
                  traderWallets: followedWallets,
                };
              } else {
                filter = msg.filter;
              }
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
