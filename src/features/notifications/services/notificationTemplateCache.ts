import type {
  NotificationTemplateRow,
  NotificationTemplate,
  SmsTemplateRow,
} from '../types/notificationProducer';
import {
  buildNotificationTemplateMap,
  buildSmsTemplateMap,
} from '../models/notificationProducerModel';

export const NOTIFICATION_TEMPLATE_CACHE_TTL_MS =
  5 * 60 * 1000;

export interface NotificationTemplateCacheDependencies {
  fetchNotificationRows:
    () =>
      Promise<
        NotificationTemplateRow[]
      >;

  fetchSmsRows:
    () =>
      Promise<
        SmsTemplateRow[]
      >;

  now: () => number;
}

export interface NotificationTemplateCache {
  getNotificationTemplates():
    Promise<
      Map<
        string,
        NotificationTemplate
      >
    >;

  getSmsTemplates():
    Promise<Map<string, string>>;

  invalidate(): void;
}

export function createNotificationTemplateCache(
  dependencies:
    NotificationTemplateCacheDependencies
): NotificationTemplateCache {
  let notificationTemplateCache:
    | Map<
        string,
        NotificationTemplate
      >
    | null = null;
  let notificationLoadedAt = 0;

  let smsTemplateCache:
    | Map<string, string>
    | null = null;
  let smsLoadedAt = 0;

  return {
    async getNotificationTemplates():
      Promise<
        Map<
          string,
          NotificationTemplate
        >
      > {
      if (
        notificationTemplateCache &&
        dependencies.now() -
          notificationLoadedAt <
          NOTIFICATION_TEMPLATE_CACHE_TTL_MS
      ) {
        return notificationTemplateCache;
      }

      const rows =
        await dependencies.fetchNotificationRows();
      const map =
        buildNotificationTemplateMap(
          rows
        );
      notificationTemplateCache = map;
      notificationLoadedAt =
        dependencies.now();
      return map;
    },

    async getSmsTemplates():
      Promise<
        Map<string, string>
      > {
      if (
        smsTemplateCache &&
        dependencies.now() -
          smsLoadedAt <
          NOTIFICATION_TEMPLATE_CACHE_TTL_MS
      ) {
        return smsTemplateCache;
      }

      const rows =
        await dependencies.fetchSmsRows();
      const map =
        buildSmsTemplateMap(rows);
      smsTemplateCache = map;
      smsLoadedAt =
        dependencies.now();
      return map;
    },

    invalidate(): void {
      notificationTemplateCache =
        null;
      smsTemplateCache = null;
    },
  };
}
