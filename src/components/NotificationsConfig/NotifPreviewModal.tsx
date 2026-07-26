import { useState } from 'react';
import { X, Eye } from 'lucide-react';
import {
  TEMPLATE_CATEGORIES as NOTIF_CATEGORIES,
} from '../../config/templateCatalog';
import {
  COLORS, COLOR_BADGE, AUDIENCE_COLORS, audienceLabel, eventLabel,
  NOTIF_SAMPLE_VALUES, type NotificationTemplate,
} from './types';

export function fillNotifPreview(text: string, customVars: Record<string, string>): string {
  const vars = { ...NOTIF_SAMPLE_VALUES, ...customVars };
  return text.replace(/\{\{(\w+)\}\}/g, (_m, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
}

export function NotifPreviewModal({ template, onClose }: { template: NotificationTemplate; onClose: () => void }) {
  const [customVars, setCustomVars] = useState<Record<string, string>>({});

  const allKeys = Array.from(new Set([
    ...(template.placeholders || []),
    ...Array.from((template.title + ' ' + template.body).matchAll(/\{\{(\w+)\}\}/g), m => m[1]),
  ]));

  const previewTitle = fillNotifPreview(template.title, customVars);
  const previewBody  = fillNotifPreview(template.body, customVars);
  const colorDot = COLORS.find(c => c.key === template.color);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-white text-sm flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-500" />پیش‌نمایش قالب اعلان
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${COLOR_BADGE[template.color] || COLOR_BADGE['gray']}`}>
              {NOTIF_CATEGORIES.find(c => c.key === template.category)?.label || template.category}
            </span>
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-full">
              {eventLabel[template.event_type] || template.event_type}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full ${AUDIENCE_COLORS[template.audience] || AUDIENCE_COLORS.all}`}>
              {audienceLabel[template.audience] || template.audience}
            </span>
          </div>

          {allKeys.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">مقادیر نمونه (قابل تغییر):</p>
              <div className="grid grid-cols-1 gap-2 max-h-44 overflow-y-auto">
                {allKeys.map(key => (
                  <div key={key} className="flex items-center gap-2">
                    <code className="text-xs text-amber-600 dark:text-amber-400 font-mono bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded w-36 shrink-0 truncate">{`{{${key}}}`}</code>
                    <input
                      type="text"
                      value={customVars[key] ?? (NOTIF_SAMPLE_VALUES[key] || '')}
                      onChange={e => setCustomVars(v => ({ ...v, [key]: e.target.value }))}
                      className="flex-1 text-xs px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder={`مقدار {{${key}}}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">خروجی اعلان:</p>
            <div className={`rounded-xl border p-4 space-y-1.5 ${COLOR_BADGE[template.color] || ''} bg-opacity-20`}>
              <div className="flex items-start gap-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1 ${colorDot?.cls || 'bg-gray-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-white leading-snug">{previewTitle || '—'}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed whitespace-pre-wrap">{previewBody || '—'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
