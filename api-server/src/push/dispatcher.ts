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
import { pushFailuresTotal, pushSkipsTotal, pushesSentTotal } from '../observability.js';
import { isInQuietHours } from '../alerts/quiet_hours.js';
import { normalizeWhaleMessage } from '../shared/whale_message.js';

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
    pushSkipsTotal.inc({ reason: 'duplicate_notification' });
    logger.debug({ whaleId: whale.id, fcmToken: sub.fcmToken }, 'notification already sent by another instance');
    return;
  }

  try {
    await sendPush(
      sub.fcmToken,
      {
        title: `Whale alert: ${formatUsdShort(whale.usdSize)} ${whale.side}`,
        body: `${whale.market?.title ?? 'Unknown'} - ${whale.outcome} @ ${whale.priceCents}c`,
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
    pushFailuresTotal.inc({ platform: sub.platform, code: errorCode });
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

        let whale: WhaleDto | null;
        try {
          whale = normalizeWhaleMessage(JSON.parse(message));
        } catch {
          logger.warn({ message }, 'failed to parse whale from redis');
          return;
        }
        if (!whale) {
          logger.warn({ message }, 'redis whale missing id');
          return;
        }

        logger.info({ whaleId: whale.id, usdSize: whale.usdSize }, 'processing new whale');

        const matching = await findMatchingSubscriptions(
          whale.usdSize,
          whale.market?.category ?? ''
        );

        for (const sub of matching) {
          if (isInQuietHours(sub.quietHours)) {
            pushSkipsTotal.inc({ reason: 'quiet_hours' });
            logger.debug({ whaleId: whale.id, userId: sub.userId }, 'push skipped during quiet hours');
            continue;
          }

          const currentCount = await getPushCount(sub.userId);
          if (currentCount >= maxPushesPerHour) {
            pushSkipsTotal.inc({ reason: 'rate_limit' });
            logger.info({
              whaleId: whale.id,
              userId: sub.userId,
              currentCount,
              maxPushesPerHour,
            }, 'push skipped because user hourly rate limit was reached');
            continue;
          }

          await maybeSendPush(db, whale, sub, maxPushesPerHour);
        }
      });
    },
  };
}
