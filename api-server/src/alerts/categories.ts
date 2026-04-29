export const ALERT_CATEGORIES = ['Politics', 'Crypto', 'Sports', 'Tech', 'Culture'] as const;

export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

