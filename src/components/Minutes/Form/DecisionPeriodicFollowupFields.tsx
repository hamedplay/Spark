import { useEffect, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import type { DraftDecision, FollowupRecurrence, FollowupRecipientType } from './types';

interface Props {
  item: DraftDecision;
  readOnly?: boolean;
  update: (id: string, field: keyof DraftDecision, value: DraftDecision[keyof DraftDecision]) => void;
}

export function DecisionPeriodicFollowupFields({ item, readOnly, update }: Props) {
  const requestedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!item.decisionId || item.followupRecurrence !== undefined || requestedIdRef.current === item.decisionId) return;
    requestedIdRef.current = item.decisionId;

    void (async () => {
      const { data, error } = await supabase.rpc('get_minutes_decision_periodic_settings', {
        p_decision_ids: [item.decisionId],
      });
      if (error) {
        console.error('[Minutes periodic follow-up] settings load failed:', error);
        requestedIdRef.current = null;
        return;
      }

      const row = Array.isArray(data) ? data[0] : null;
      update(item.id, 'followupRecurrence', ((row?.followup_recurrence as FollowupRecurrence | undefined) || 'none'));
      update(item.id, 'followupRecipientType', ((row?.followup_recipient_type as FollowupRecipientType | undefined) || 'secretary'));
      update(item.id, 'nextPeriodicFollowupAt', (row?.next_periodic_followup_at as string | null | undefined) ?? null);
    })();
  }, [item.decisionId, item.followupRecurrence, item.id, update]);

  const recurrence = item.followupRecurrence ?? 'none';
  const recipientType = item.followupRecipientType ?? 'secretary';
  const ownerUnavailable = item.responsiblePartyType !== 'internal' || !item.primaryOwnerUserId;

  return (
    <div className="sm:col-span-2 rounded-xl border border-purple-100 bg-purple-50/60 p-3 dark:border-purple-900/40 dark:bg-purple-900/10">
      <div className="mb-3">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">پیگیری دوره‌ای در جلسات آینده</div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          در موعد انتخاب‌شده، برای طرح مجدد این مصوبه در دستور جلسه بعدی اعلان ارسال می‌شود.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">تناوب</label>
          <select
            value={recurrence}
            onChange={event => {
              const value = event.target.value as FollowupRecurrence;
              update(item.id, 'followupRecurrence', value);
              if (value !== 'none') update(item.id, 'requiresFollowup', true);
            }}
            disabled={!!readOnly}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white disabled:opacity-60"
          >
            <option value="none">بدون تکرار</option>
            <option value="weekly">هفتگی</option>
            <option value="monthly">ماهانه</option>
          </select>
        </div>

        {recurrence !== 'none' && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">گیرنده اعلان</label>
            <select
              value={ownerUnavailable && recipientType === 'owner' ? 'secretary' : recipientType}
              onChange={event => update(item.id, 'followupRecipientType', event.target.value as FollowupRecipientType)}
              disabled={!!readOnly}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white disabled:opacity-60"
            >
              <option value="secretary">دبیر جلسه</option>
              <option value="owner" disabled={ownerUnavailable}>مسئول مصوبه</option>
            </select>
            {ownerUnavailable && (
              <p className="mt-1 text-xs text-gray-400">برای مسئول خارج سازمان یا مصوبه بدون مسئول داخلی، اعلان به دبیر ارسال می‌شود.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
