import type {
  NotificationTemplateRow,
  NotificationTemplate,
  SmsTemplateRow,
  NotifyChannels,
  NotificationChannelSelection,
} from '../types/notificationProducer';

export function buildNotificationTemplateKey(
  category: string,
  eventType: string,
  audience: string
): string {
  return (
    `${category}:` +
    `${eventType}:` +
    audience
  );
}

export function resolveNotificationAudience(
  audience: string | undefined
): string {
  return audience || 'all';
}

export function buildNotificationTemplateMap(
  rows:
    readonly NotificationTemplateRow[]
): Map<
  string,
  NotificationTemplate
> {
  const map = new Map<
    string,
    NotificationTemplate
  >();

  for (const row of rows) {
    const key =
      buildNotificationTemplateKey(
        row.category,
        row.event_type,
        row.audience
      );

    if (!map.has(key)) {
      map.set(key, {
        id: row.id,
        title: row.title,
        body: row.body,
        updatedAt:
          row.updated_at,
      });
    }
  }

  return map;
}

export function buildSmsTemplateMap(
  rows:
    readonly SmsTemplateRow[]
): Map<string, string> {
  const map = new Map<
    string,
    string
  >();

  for (const row of rows) {
    const key =
      buildNotificationTemplateKey(
        row.category,
        row.event_type,
        row.audience
      );

    map.set(key, row.body);
  }

  return map;
}

export function resolveNotificationTemplate(
  templates:
    ReadonlyMap<
      string,
      NotificationTemplate
    >,
  category: string,
  eventType: string,
  audience: string
): NotificationTemplate | undefined {
  const exactKey =
    buildNotificationTemplateKey(
      category,
      eventType,
      audience
    );

  const exact =
    templates.get(exactKey);
  if (exact) return exact;

  const allKey =
    buildNotificationTemplateKey(
      category,
      eventType,
      'all'
    );

  return templates.get(allKey);
}

export function resolveSmsTemplateBody(
  templates:
    ReadonlyMap<string, string>,
  category: string,
  eventType: string,
  audience: string,
  fallbackMessage: string
): string {
  const exactKey =
    buildNotificationTemplateKey(
      category,
      eventType,
      audience
    );

  const exact =
    templates.get(exactKey);
  if (exact) return exact;

  const allKey =
    buildNotificationTemplateKey(
      category,
      eventType,
      'all'
    );

  const all =
    templates.get(allKey);
  if (all) return all;

  return fallbackMessage;
}

export function resolveNotificationChannels(
  channels:
    NotifyChannels | undefined
): NotificationChannelSelection {
  return {
    inAppEnabled:
      channels?.inApp !== false,

    smsEnabled:
      channels?.sms !== false,

    baleEnabled:
      channels?.bale !== false,
  };
}

export function buildBaleNotificationText(
  title: string,
  message: string
): string {
  return title !== message
    ? `${title}\n${message}`
    : message;
}

export function isDuplicateNotificationRpcResult(
  result: unknown
): boolean {
  const normalized =
    Array.isArray(result)
      ? result[0]
      : result;

  return (
    normalized?.created === false
  );
}
