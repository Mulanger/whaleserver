import type { MobilePlatform } from '../shared/types.js';
import {
  upsertAlertSubscription,
  deleteAlertSubscriptionByToken,
  deleteAllAlertSubscriptionsForUser,
  getLatestAlertSubscriptionForUser,
} from '../db/repos/alerts_repo.js';

export interface SubscribeInput {
  userId: string;
  fcmToken: string;
  minUsd: number;
  megaOnly: boolean;
  categories: string[];
  quietHours?: { start: string; end: string; tz: string } | null;
  platform?: MobilePlatform;
}

export async function subscribeToAlerts(input: SubscribeInput): Promise<void> {
  await upsertAlertSubscription({
    userId: input.userId,
    fcmToken: input.fcmToken,
    platform: input.platform,
    minUsd: input.minUsd,
    megaOnly: input.megaOnly,
    categories: input.categories,
    quietHours: input.quietHours,
  });
}

export async function unsubscribeFromAlerts(
  userId: string,
  fcmToken?: string
): Promise<void> {
  if (fcmToken) {
    await deleteAlertSubscriptionByToken(userId, fcmToken);
    return;
  }

  await deleteAllAlertSubscriptionsForUser(userId);
}

export async function getHydrationSubscription(userId: string) {
  return getLatestAlertSubscriptionForUser(userId);
}

