import type { WebSocket } from 'ws';
import type { Redis } from 'ioredis';
import type { WhaleDto, WhaleFilter } from '../shared/types.js';
import { matches } from './filters.js';
import { logger } from '../logger.js';
import { wsConnectionsTotal, wsConnectionsActive } from '../observability.js';

interface ClientEntry {
  socket: WebSocket;
  filter: WhaleFilter;
  userId: string | null;
  ip: string;
  connectedAt: number;
  lastSeenAt: number;
  messageCount: number;
  lastMessageReset: number;
}

const MAX_QUEUE_SIZE = 100;
const MAX_MESSAGES_PER_SEC = 100;
const MAX_CONNS_PER_IP = 5;

export function createHub(redisSub: Redis) {
  const clients = new Map<string, ClientEntry>();
  const ipCounts = new Map<string, number>();
  let connCounter = 0;

  redisSub.on('message', (_channel: string, message: string) => {
    let whale: WhaleDto;
    try {
      whale = JSON.parse(message) as WhaleDto;
    } catch {
      return;
    }

    for (const [connId, client] of clients) {
      try {
        if (matches(whale, client.filter)) {
          if (client.socket.readyState === 1) {
            client.socket.send(JSON.stringify({ type: 'whale', data: whale }));
          }
        }
      } catch (e) {
        logger.error({ e, connId }, 'error broadcasting to client');
      }
    }
  });

  function checkRateLimit(client: ClientEntry): boolean {
    const now = Date.now();
    if (now - client.lastMessageReset > 1000) {
      client.messageCount = 0;
      client.lastMessageReset = now;
    }
    client.messageCount++;
    return client.messageCount <= MAX_MESSAGES_PER_SEC;
  }

  return {
    add(socket: WebSocket, filter: WhaleFilter, userId: string | null, ip: string): string | null {
      const currentCount = ipCounts.get(ip) ?? 0;
      if (currentCount >= MAX_CONNS_PER_IP) {
        socket.close(1008, 'too many connections from this IP');
        return null;
      }

      const connId = `conn_${++connCounter}`;
      clients.set(connId, {
        socket,
        filter,
        userId,
        ip,
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
        messageCount: 0,
        lastMessageReset: Date.now(),
      });
      ipCounts.set(ip, currentCount + 1);
      wsConnectionsTotal.inc({ platform: userId ? 'authenticated' : 'anonymous' });
      wsConnectionsActive.inc();
      return connId;
    },

    remove(connId: string) {
      const client = clients.get(connId);
      if (client) {
        const currentCount = ipCounts.get(client.ip) ?? 1;
        if (currentCount <= 1) {
          ipCounts.delete(client.ip);
        } else {
          ipCounts.set(client.ip, currentCount - 1);
        }
        clients.delete(connId);
        wsConnectionsActive.dec();
      }
    },

    updateFilter(connId: string, filter: WhaleFilter) {
      const client = clients.get(connId);
      if (client) {
        client.filter = filter;
        client.lastSeenAt = Date.now();
      }
    },

    closeAll(code: number, reason: string) {
      for (const [connId, client] of clients) {
        try {
          client.socket.close(code, reason);
        } catch {
          // ignore
        }
        clients.delete(connId);
      }
      ipCounts.clear();
    },

    broadcast(whale: WhaleDto) {
      for (const [connId, client] of clients) {
        if (matches(whale, client.filter)) {
          try {
            client.socket.send(JSON.stringify({ type: 'whale', data: whale }));
          } catch {
            // ignore
          }
        }
      }
    },

    onClientMessage(connId: string): boolean {
      const client = clients.get(connId);
      if (!client) return true;
      client.lastSeenAt = Date.now();
      if (!checkRateLimit(client)) {
        client.socket.close(1008, 'rate limit exceeded');
        return false;
      }
      return true;
    },
  };
}

export type Hub = ReturnType<typeof createHub>;