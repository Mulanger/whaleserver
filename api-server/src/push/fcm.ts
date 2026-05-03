import admin from 'firebase-admin';
import { config } from '../config.js';
import { logger } from '../logger.js';

let fcmApp: admin.app.App | null = null;

function getFcmApp(): admin.app.App | null {
  if (config.FIREBASE_PROJECT_ID === 'mock') return null;
  if (fcmApp) return fcmApp;

  if (!config.FIREBASE_PROJECT_ID || !config.FIREBASE_CLIENT_EMAIL || !config.FIREBASE_PRIVATE_KEY) {
    return null;
  }

  fcmApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: config.FIREBASE_PROJECT_ID,
      clientEmail: config.FIREBASE_CLIENT_EMAIL,
      privateKey: config.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });

  return fcmApp;
}

export async function sendPush(
  token: string,
  notification: { title: string; body: string },
  data: Record<string, string>
): Promise<void> {
  const app = getFcmApp();
  const ttlMs = config.FCM_MESSAGE_TTL_SECONDS * 1000;
  const apnsExpiration = String(Math.floor(Date.now() / 1000) + config.FCM_MESSAGE_TTL_SECONDS);

  if (!app) {
    logger.info({ token, notification }, 'mock push sent');
    return;
  }

  try {
    await app.messaging().send({
      token,
      notification,
      data,
      apns: {
        payload: { aps: { sound: 'default', 'mutable-content': 1 } },
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
          'apns-expiration': apnsExpiration,
        },
      },
      android: {
        ttl: ttlMs,
        priority: 'high',
        notification: {
          channelId: 'whale_alerts',
          sound: 'default',
          icon: 'ic_stat_whale_alert',
          color: '#12B981',
        },
      },
      webpush: {
        notification: {
          icon: '/assets/polywatch-icon.png',
          badge: '/assets/polywatch-icon.png',
          tag: data.tradeId ? `polywatch-whale-${data.tradeId}` : 'polywatch-whale-alert',
        },
      },
    });
  } catch (e) {
    logger.error({ error: e, token }, 'failed to send FCM push');
    throw e;
  }
}

export function isInvalidTokenError(e: unknown): boolean {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = (e as { code: string }).code;
    return code === 'messaging/registration-token-not-registered' ||
           code === 'messaging/invalid-argument';
  }
  return false;
}
