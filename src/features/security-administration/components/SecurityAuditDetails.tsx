import { X } from 'lucide-react';
import type { AuditEvent } from '../types/securityAdministration';
import {
  labelEventType, labelCategory, labelSeverity, labelResult, labelErrorCode,
} from '../utils/securityAuditLabels';

interface Props {
  event: AuditEvent;
  onClose: () => void;
}

export function SecurityAuditDetails({ event, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">
            جزئیات رویداد امنیتی
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="نوع رویداد" value={labelEventType(event.event_type)} />
          <Field label="دسته" value={labelCategory(event.event_category)} />
          <Field label="سطح اهمیت" value={labelSeverity(event.severity)} />
          <Field label="نتیجه" value={labelResult(event.result)} />
          <Field label="کد خطا" value={event.error_code ? labelErrorCode(event.error_code) : '—'} />
          <Field label="زمان" value={new Date(event.created_at).toLocaleString('fa-IR')} />
          <Field label="Actor" value={event.actor?.display_name ?? '—'} />
          <Field label="Target" value={event.target?.display_name ?? '—'} />
          <Field label="Request ID" value={event.request_id ?? '—'} mono />
          <Field label="Session ID" value={event.session_id ?? '—'} mono />
        </div>

        {event.metadata && Object.keys(event.metadata).length > 0 && (
          <JsonSection label="Metadata" data={event.metadata} />
        )}
        {event.before_state && (
          <JsonSection label="Before State" data={event.before_state} />
        )}
        {event.after_state && (
          <JsonSection label="After State" data={event.after_state} />
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className={`text-gray-800 dark:text-white ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}

function JsonSection({ label, data }: { label: string; data: Record<string, unknown> | null }) {
  if (!data) return null;
  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <pre className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl text-xs overflow-x-auto text-gray-700 dark:text-gray-300" dir="ltr">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
