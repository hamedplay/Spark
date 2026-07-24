import { useState } from 'react';
import {
  Settings,
  X,
  Check,
  Sun,
  Moon,
  Calendar,
  CalendarDays,
  Clock,
  Eye,
  EyeOff,
  LayoutGrid as LayoutCompact,
  Bell,
  LayoutDashboard,
  LayoutList,
  SquareCheck as CheckSquare,
} from 'lucide-react';

import {
  useTheme,
  ACCENT_COLORS,
  AccentKey,
} from '../../../context/ThemeContext';
import {
  useUserPreferences,
} from '../../../context/UserPreferencesContext';

export interface UserSettingsModalProps {
  onClose: () => void;
}

const CALENDAR_VIEWS = [
  {
    key: 'month',
    label: 'ماهانه',
    icon: Calendar,
  },
  {
    key: 'week',
    label: 'هفتگی',
    icon: CalendarDays,
  },
  {
    key: 'day',
    label: 'روزانه',
    icon: Clock,
  },
  {
    key: 'list',
    label: 'لیستی',
    icon: LayoutList,
  },
] as const;

const LANDING_PAGES = [
  {
    key: 'calendar',
    label: 'تقویم',
    icon: Calendar,
  },
  {
    key: 'meetings',
    label: 'جلسات',
    icon: LayoutDashboard,
  },
  {
    key: 'tasks',
    label: 'اقدامات',
    icon: CheckSquare,
  },
] as const;

const REMINDER_OPTIONS = [
  5, 10, 15, 30, 60,
] as const;

type BooleanPreferenceKey =
  | 'show_past_meetings'
  | 'show_cancelled_meetings'
  | 'compact_cards'
  | 'notifications_enabled';

export function UserSettingsModal({
  onClose,
}: UserSettingsModalProps) {
  const { theme, toggleTheme, accent, setAccent } =
    useTheme();
  const { prefs, updatePrefs } =
    useUserPreferences();
  const [saving, setSaving] = useState(false);

  const handle = async (
    patch: Parameters<typeof updatePrefs>[0]
  ) => {
    setSaving(true);
    await updatePrefs(patch);
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      dir="rtl"
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <Settings className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white">
              تنظیمات کاربری
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 p-5 space-y-6">
          {/* ── Dark / Light mode */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              حالت نمایش
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() =>
                  theme === 'dark' && toggleTheme()
                }
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                  theme === 'light'
                    ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                  <Sun className="w-4 h-4 text-amber-500" />
                </div>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  روز
                </span>
                {theme === 'light' && (
                  <Check className="w-3 h-3 text-teal-500" />
                )}
              </button>
              <button
                onClick={() =>
                  theme === 'light' && toggleTheme()
                }
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                  theme === 'dark'
                    ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                  <Moon className="w-4 h-4 text-blue-500" />
                </div>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  شب
                </span>
                {theme === 'dark' && (
                  <Check className="w-3 h-3 text-teal-500" />
                )}
              </button>
            </div>
          </div>

          {/* ── Accent color palette */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              رنگ اصلی
            </p>
            <div className="grid grid-cols-5 gap-2">
              {ACCENT_COLORS.map((c) => (
                <button
                  key={c.key}
                  onClick={() =>
                    setAccent(c.key as AccentKey)
                  }
                  title={c.label}
                  className={`group flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all ${
                    accent === c.key
                      ? 'bg-gray-100 dark:bg-gray-700 ring-2 ring-offset-1 dark:ring-offset-gray-800'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'
                  }`}
                  style={
                    accent === c.key
                      ? ({
                          '--ring-color': c.hex,
                        } as React.CSSProperties)
                      : {}
                  }
                >
                  <span
                    className="w-7 h-7 rounded-full shadow-sm flex items-center justify-center transition-transform group-hover:scale-110"
                    style={{
                      backgroundColor: c.hex,
                    }}
                  >
                    {accent === c.key && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight text-center">
                    {c.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-700" />

          {/* ── Default calendar view */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              نمای پیش‌فرض تقویم
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {CALENDAR_VIEWS.map((v) => {
                const Icon = v.icon;
                const active =
                  prefs.default_calendar_view ===
                  v.key;
                return (
                  <button
                    key={v.key}
                    onClick={() =>
                      handle({
                        default_calendar_view: v.key,
                      })
                    }
                    className={`flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-xl border-2 transition-all ${
                      active
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400'
                        : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[11px] font-medium">
                      {v.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Calendar preferences */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              تنظیمات تقویم
            </p>
            <div className="space-y-3">
              {/* Hide off-hours toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    پنهان کردن ساعات غیرکاری
                  </span>
                </div>
                <button
                  onClick={() =>
                    handle({
                      hide_offhours: !prefs.hide_offhours,
                    })
                  }
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    prefs.hide_offhours
                      ? 'bg-teal-500'
                      : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                      prefs.hide_offhours
                        ? 'right-0.5'
                        : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Work hours */}
              <div className="space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  ساعات کاری شخصی (پیش‌فرض: تنظیمات سازمان)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">
                      شروع
                    </label>
                    <select
                      value={
                        prefs.work_start_time ?? ''
                      }
                      onChange={(e) =>
                        handle({
                          work_start_time:
                            e.target.value || null,
                        })
                      }
                      className="w-full py-1.5 px-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
                      dir="ltr"
                    >
                      <option value="">پیش‌فرض</option>
                      {Array.from(
                        { length: 48 },
                        (_, i) => {
                          const h = Math.floor(i / 2)
                            .toString()
                            .padStart(2, '0');
                          const m =
                            i % 2 === 0 ? '00' : '30';
                          return (
                            <option
                              key={i}
                              value={`${h}:${m}`}
                            >{`${h}:${m}`}</option>
                          );
                        }
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">
                      پایان
                    </label>
                    <select
                      value={
                        prefs.work_end_time ?? ''
                      }
                      onChange={(e) =>
                        handle({
                          work_end_time:
                            e.target.value || null,
                        })
                      }
                      className="w-full py-1.5 px-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
                      dir="ltr"
                    >
                      <option value="">پیش‌فرض</option>
                      {Array.from(
                        { length: 48 },
                        (_, i) => {
                          const h = Math.floor(i / 2)
                            .toString()
                            .padStart(2, '0');
                          const m =
                            i % 2 === 0 ? '00' : '30';
                          return (
                            <option
                              key={i}
                              value={`${h}:${m}`}
                            >{`${h}:${m}`}</option>
                          );
                        }
                      )}
                    </select>
                  </div>
                </div>
                {(prefs.work_start_time ||
                  prefs.work_end_time) && (
                  <button
                    onClick={() =>
                      handle({
                        work_start_time: null,
                        work_end_time: null,
                      })
                    }
                    className="text-[11px] text-red-500 hover:text-red-600 dark:text-red-400 transition-colors"
                  >
                    بازگشت به پیش‌فرض سازمان
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Default landing page */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              صفحه پیش‌فرض بعد از ورود
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {LANDING_PAGES.map((p) => {
                const Icon = p.icon;
                const active =
                  prefs.default_landing_page === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() =>
                      handle({
                        default_landing_page: p.key,
                      })
                    }
                    className={`flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-xl border-2 transition-all ${
                      active
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400'
                        : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[11px] font-medium">
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Default reminder */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              یادآوری پیش‌فرض جلسات
            </p>
            <div className="flex flex-wrap gap-1.5">
              {REMINDER_OPTIONS.map((mins) => (
                <button
                  key={mins}
                  onClick={() =>
                    handle({ reminder_minutes: mins })
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all ${
                    prefs.reminder_minutes === mins
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                  }`}
                >
                  {mins} دقیقه
                </button>
              ))}
            </div>
          </div>

          {/* ── Toggle switches */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              نمایش و رفتار
            </p>

            {[
              {
                key: 'show_past_meetings',
                label: 'نمایش جلسات گذشته',
                icon: Eye,
              },
              {
                key: 'show_cancelled_meetings',
                label: 'نمایش جلسات لغوشده',
                icon: EyeOff,
              },
              {
                key: 'compact_cards',
                label: 'حالت فشرده کارت‌ها',
                icon: LayoutCompact,
              },
              {
                key: 'notifications_enabled',
                label: 'فعال‌سازی اعلان‌ها',
                icon: Bell,
              },
            ].map((item) => {
              const Icon = item.icon;
              const val = prefs[
                item.key as keyof typeof prefs
              ] as boolean;
              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {item.label}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      const key =
                        item.key as BooleanPreferenceKey;
                      handle({ [key]: !val });
                    }}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      val
                        ? 'bg-teal-500'
                        : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                        val ? 'right-0.5' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-2 flex-shrink-0 border-t border-gray-100 dark:border-gray-700">
          {saving && (
            <p className="text-xs text-teal-500 text-center mb-2">
              در حال ذخیره...
            </p>
          )}
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-xl transition-colors"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}
