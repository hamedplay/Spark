import {
  createNotificationTemplateCache,
} from './notificationTemplateCache';
import {
  fetchActiveNotificationTemplateRows,
  fetchActiveSmsTemplateRows,
} from '../repositories/notificationTemplateRepository';

const defaultCache =
  createNotificationTemplateCache({
    fetchNotificationRows:
      fetchActiveNotificationTemplateRows,
    fetchSmsRows:
      fetchActiveSmsTemplateRows,
    now: () => Date.now(),
  });

export async function getNotificationTemplates() {
  return defaultCache.getNotificationTemplates();
}

export async function getSmsTemplates() {
  return defaultCache.getSmsTemplates();
}

export function invalidateTemplateCache() {
  defaultCache.invalidate();
}
