import type { AlertSubscription } from '../shared/types.js';

const MEGA_MIN_USD = 250_000;

function categoriesMatch(subscriptionCategories: string[], marketCategory: string): boolean {
  if (subscriptionCategories.length === 0) return true;
  return subscriptionCategories.includes(marketCategory);
}

export function matchesSubscription(
  whale: { usdSize: number; marketCategory: string },
  subscription: Pick<AlertSubscription, 'minUsd' | 'megaOnly' | 'categories'>
): boolean {
  if (whale.usdSize < subscription.minUsd) return false;
  if (subscription.megaOnly && whale.usdSize < MEGA_MIN_USD) return false;
  return categoriesMatch(subscription.categories, whale.marketCategory);
}

