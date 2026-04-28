import type { Db } from 'mongodb';
import type { Redis } from 'ioredis';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import {
  findMatchingSubscriptions,
  updateLastNotified,
  deleteSubscription,
  tryInsertNotificationLog,
  markNotificationFailed,
} from '../db/repos/alerts_repo.js';
import { sendPush, isInvalidTokenError } from './fcm.js';
import { incrementPushCount, getPushCount } from '../redis/locks.js';
import type { WhaleDto, AlertSubscription } from '../shared/types.js';
import { pushesSentTotal } from '../observability.js';

function inQuietHours(sub: { quietHours?: { start: string; end: string; tz: string } | null }): boolean {
  if (!sub.quietHours) return false;

  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: sub.quietHours.tz }));
  const mins = local.getHours() * 60 + local.getMinutes();
  const [sh, sm] = sub.quietHours.start.split(':').map(Number);
  const [eh, em] = sub.quietHours.end.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  if (start <= end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

function formatUsdShort(usdSize: number): string {
  if (usdSize >= 1_000_000) return `$${(usdSize / 1_000_000).toFixed(1)}M`;
  if (usdSize >= 1_000) return `$${(usdSize / 1_000).toFixed(0)}K`;
  return `$${usdSize}`;
}

async function maybeSendPush(
  db: Db,
  whale: WhaleDto,
  sub: AlertSubscription,
  maxPushesPerHour: number
): Promise<void> {
  const acquired = await tryInsertNotificationLog(whale.id, sub.fcmToken);
  if (!acquired) {
    logger.debug({ whaleId: whale.id, fcmToken: sub.fcmToken }, 'notification already sent by another instance');
    return;
  }

  try {
    await sendPush(
      sub.fcmToken,
      {
        title: `🐋 ${formatUsdShort(whale.usdSize)} ${whale.side} whale`,
        body: `${whale.market?.title ?? 'Unknown'} · ${whale.outcome} @ ${whale.priceCents}¢`,
      },
      { type: 'whale', tradeId: whale.id }
    );
    await incrementPushCount(sub.userId);
    await updateLastNotified(sub._id);
    pushesSentTotal.inc({ platform: sub.platform, result: 'sent' });
    logger.info({ whaleId: whale.id, userId: sub.userId }, 'push sent');
  } catch (e) {
    const errorCode = (e as { code?: string }).code ?? 'unknown';
    await markNotificationFailed(whale.id, sub.fcmToken, errorCode);
    pushesSentTotal.inc({ platform: sub.platform, result: 'failed' });
    if (isInvalidTokenError(e)) {
      logger.warn({ fcmToken: sub.fcmToken }, 'invalid FCM token, removing subscription');
      await deleteSubscription(sub._id);
    }
  }
}

export function createDispatcher(redisSub: Redis, db: Db, config: Config) {
  const maxPushesPerHour = config.MAX_PUSHES_PER_USER_PER_HOUR;

  return {
    start() {
      redisSub.on('message', async (channel: string, message: string) => {
        if (channel !== config.REDIS_CHANNEL) return;

        let whale: WhaleDto;
        try {
          whale = JSON.parse(message) as WhaleDto;
        } catch {
          logger.warn({ message }, 'failed to parse whale from redis');
          return;
        }

        logger.info({ whaleId: whale.id, usdSize: whale.usdSize }, 'processing new whale');

        const matching = await findMatchingSubscriptions(
          whale.usdSize,
          whale.market?.category ?? '',
          whale.tier
        );

        for (const sub of matching) {
          if (inQuietHours(sub)) continue;

          const currentCount = await getPushCount(sub.userId);
          if (currentCount >= maxPushesPerHour) {
            logger.debug({ userId: sub.userId }, 'push rate limit exceeded for user');
            continue;
          }

          await maybeSendPush(db, whale, sub, maxPushesPerHour);
        }
      });
    },
  };
}