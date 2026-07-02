import React, { useState } from 'react';
import { X, Palette, MessageSquare, Bell, LayoutGrid as Layout, Check } from 'lucide-react';

export interface ChatThemeSettings {
  // Bubble colors
  sentBubbleColor: string;
  receivedBubbleColor: string;
  // Background
  backgroundStyle: 'dots' | 'lines' | 'plain' | 'gradient';
  backgroundGradientFrom: string;
  backgroundGradientTo: string;
  // Message type accent colors
  importantColor: string;
  urgentColor: string;
  confidentialColor: string;
  // Font size
  fontSize: 'sm' | 'md' | 'lg';
  // Bubble shape
  bubbleRadius: 'rounded' | 'sharp' | 'pill';
}

export const DEFAULT_CHAT_THEME: ChatThemeSettings = {
  sentBubbleColor: '#e8f5ee',
  receivedBubbleColor: '#ffffff',
  backgroundStyle: 'dots',
  backgroundGradientFrom: '#f0fdf4',
  backgroundGradientTo: '#ecfdf5',
  importantColor: '#f59e0b',
  urgentColor: '#ef4444',
  confidentialColor: '#6b7280',
  fontSize: 'md',
  bubbleRadius: 'rounded',
};

const STORAGE_KEY = 'chat_theme_settings';

export function loadChatTheme(): ChatThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CHAT_THEME, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CHAT_THEME };
}

export function saveChatTheme(settings: ChatThemeSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

interface Props {
  onClose: () => void;
}

type Section = 'bubbles' | 'background' | 'types' | 'display';

const SECTION_LABELS: Record<Section, string> = {
  bubbles: 'رنگ حباب‌ها',
  background: 'پس‌زمینه',
  types: 'رنگ نوع پیام',
  display: 'نمایش',
};

const SECTION_ICONS: Record<Section, React.ElementType> = {
  bubbles: MessageSquare,
  background: Layout,
  types: Bell,
  display: Palette,
};

const PRESET_SENT_COLORS = ['#e8f5ee', '#dbeafe', '#fef3c7', '#fce7f3', '#ede9fe', '#f1f5f9'];
const PRESET_RECEIVED_COLORS = ['#ffffff', '#f8fafc', '#f0fdf4', '#fff7ed', '#fdf4ff', '#f0f9ff'];
const GRADIENT_PRESETS = [
  { from: '#f0fdf4', to: '#ecfdf5', label: 'سبز' },
  { from: '#eff6ff', to: '#dbeafe', label: 'آبی' },
  { from: '#fefce8', to: '#fef9c3', label: 'زرد' },
  { from: '#fff7ed', to: '#ffedd5', label: 'نارنجی' },
  { from: '#f9fafb', to: '#f3f4f6', label: 'خاکستری' },
  { from: '#fdf4ff', to: '#fae8ff', label: 'بنفش روشن' },
];

export function ChatSettingsPage({ onClose }: Props) {
  const [settings, setSettings] = useState<ChatThemeSettings>(loadChatTheme);
  const [activeSection, setActiveSection] = useState<Section>('bubbles');
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof ChatThemeSettings>(key: K, value: ChatThemeSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    saveChatTheme(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
    // Dispatch custom event so ChatMessage/ConversationView can react
    window.dispatchEvent(new CustomEvent('chatThemeChanged', { detail: settings }));
  };

  const handleReset = () => {
    setSettings({ ...DEFAULT_CHAT_THEME });
  };

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-teal-500" />
          <h2 className="font-bold text-gray-900 dark:text-white text-sm">تنظیمات محیط چت</h2>
        </div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Section nav — horizontal scrollable tabs */}
      <div className="flex overflow-x-auto flex-shrink-0 border-b border-gray-100 dark:border-gray-800 px-2 py-1.5 gap-1">
        {(Object.keys(SECTION_LABELS) as Section[]).map(s => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 ${activeSection === s ? 'bg-teal-500 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
          >
            <span>{React.createElement(SECTION_ICONS[s], { className: 'w-4 h-4' })}</span>
            {SECTION_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Section content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {activeSection === 'bubbles' && (
            <>
              <SettingGroup title="رنگ حباب پیام ارسالی">
                <div className="flex flex-wrap gap-2 mb-2">
                  {PRESET_SENT_COLORS.map(c => (
                    <ColorSwatch key={c} color={c} selected={settings.sentBubbleColor === c} onSelect={() => update('sentBubbleColor', c)} />
                  ))}
                </div>
                <ColorInput label="رنگ دلخواه" value={settings.sentBubbleColor} onChange={v => update('sentBubbleColor', v)} />
              </SettingGroup>

              <SettingGroup title="رنگ حباب پیام دریافتی">
                <div className="flex flex-wrap gap-2 mb-2">
                  {PRESET_RECEIVED_COLORS.map(c => (
                    <ColorSwatch key={c} color={c} selected={settings.receivedBubbleColor === c} onSelect={() => update('receivedBubbleColor', c)} />
                  ))}
                </div>
                <ColorInput label="رنگ دلخواه" value={settings.receivedBubbleColor} onChange={v => update('receivedBubbleColor', v)} />
              </SettingGroup>

              <SettingGroup title="پیش‌نمایش حباب">
                <div className="flex flex-col gap-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-800">
                  <div className="flex justify-start">
                    <div className="max-w-[70%] px-3 py-2 rounded-2xl text-sm text-gray-800 shadow-sm"
                      style={{ backgroundColor: settings.receivedBubbleColor }}>
                      سلام! این یک پیام دریافتی است
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="max-w-[70%] px-3 py-2 rounded-2xl text-sm text-gray-800 shadow-sm"
                      style={{ backgroundColor: settings.sentBubbleColor }}>
                      سلام! این یک پیام ارسالی است
                    </div>
                  </div>
                </div>
              </SettingGroup>
            </>
          )}

          {activeSection === 'background' && (
            <>
              <SettingGroup title="سبک پس‌زمینه">
                <div className="grid grid-cols-2 gap-2">
                  {(['dots', 'lines', 'plain', 'gradient'] as const).map(style => (
                    <button
                      key={style}
                      onClick={() => update('backgroundStyle', style)}
                      className={`p-3 rounded-xl border-2 text-xs font-medium transition-colors ${settings.backgroundStyle === style ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 text-teal-600' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-teal-300'}`}
                    >
                      <BackgroundPreview style={style} />
                      <span className="mt-1.5 block">
                        {style === 'dots' ? 'نقطه‌ای' : style === 'lines' ? 'خطی' : style === 'plain' ? 'ساده' : 'گرادیان'}
                      </span>
                    </button>
                  ))}
                </div>
              </SettingGroup>

              {settings.backgroundStyle === 'gradient' && (
                <SettingGroup title="رنگ گرادیان">
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {GRADIENT_PRESETS.map((g, i) => (
                      <button
                        key={i}
                        onClick={() => { update('backgroundGradientFrom', g.from); update('backgroundGradientTo', g.to); }}
                        className={`h-14 rounded-xl border-2 transition-all ${settings.backgroundGradientFrom === g.from ? 'border-teal-500 scale-105' : 'border-gray-200 dark:border-gray-700'}`}
                        style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}
                        title={g.label}
                      />
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <ColorInput label="از" value={settings.backgroundGradientFrom} onChange={v => update('backgroundGradientFrom', v)} />
                    <ColorInput label="تا" value={settings.backgroundGradientTo} onChange={v => update('backgroundGradientTo', v)} />
                  </div>
                </SettingGroup>
              )}
            </>
          )}

          {activeSection === 'types' && (
            <>
              <SettingGroup title="رنگ آیکن پیام مهم">
                <ColorInput label="رنگ" value={settings.importantColor} onChange={v => update('importantColor', v)} />
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="font-medium" style={{ color: settings.importantColor }}>پیام مهم!</span>
                  <div className="w-4 h-full border-r-4" style={{ borderColor: settings.importantColor }} />
                </div>
              </SettingGroup>
              <SettingGroup title="رنگ آیکن پیام اورژانسی">
                <ColorInput label="رنگ" value={settings.urgentColor} onChange={v => update('urgentColor', v)} />
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="font-bold" style={{ color: settings.urgentColor }}>پیام اورژانسی!</span>
                  <div className="w-4 h-full border-r-4" style={{ borderColor: settings.urgentColor }} />
                </div>
              </SettingGroup>
              <SettingGroup title="رنگ آیکن پیام محرمانه">
                <ColorInput label="رنگ" value={settings.confidentialColor} onChange={v => update('confidentialColor', v)} />
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="font-medium" style={{ color: settings.confidentialColor }}>محرمانه</span>
                </div>
              </SettingGroup>
            </>
          )}

          {activeSection === 'display' && (
            <>
              <SettingGroup title="اندازه فونت">
                <div className="flex gap-2">
                  {(['sm', 'md', 'lg'] as const).map(size => (
                    <button
                      key={size}
                      onClick={() => update('fontSize', size)}
                      className={`flex-1 py-2 rounded-xl border-2 font-medium transition-colors ${settings.fontSize === size ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 text-teal-600' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-teal-300'}`}
                      style={{ fontSize: size === 'sm' ? 11 : size === 'md' ? 13 : 16 }}
                    >
                      {size === 'sm' ? 'کوچک' : size === 'md' ? 'متوسط' : 'بزرگ'}
                    </button>
                  ))}
                </div>
              </SettingGroup>

              <SettingGroup title="شکل حباب">
                <div className="flex gap-2">
                  {(['rounded', 'sharp', 'pill'] as const).map(shape => (
                    <button
                      key={shape}
                      onClick={() => update('bubbleRadius', shape)}
                      className={`flex-1 py-2 text-xs border-2 font-medium transition-colors ${settings.bubbleRadius === shape ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 text-teal-600' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-teal-300'}`}
                      style={{ borderRadius: shape === 'rounded' ? 12 : shape === 'sharp' ? 4 : 999 }}
                    >
                      {shape === 'rounded' ? 'گرد' : shape === 'sharp' ? 'تیز' : 'بیضی'}
                    </button>
                  ))}
                </div>
              </SettingGroup>
            </>
          )}
        </div>

      {/* Footer */}
      <div className="flex gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
        <button
          onClick={handleReset}
          className="px-3 py-2 text-sm text-gray-500 hover:text-red-500 border border-gray-200 dark:border-gray-700 rounded-xl transition-colors"
        >
          بازنشانی
        </button>
        <button
          onClick={handleSave}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold transition-all ${saved ? 'bg-green-500 text-white' : 'bg-teal-500 hover:bg-teal-600 text-white'}`}
        >
          {saved ? <><Check className="w-4 h-4" /> ذخیره شد</> : 'ذخیره تنظیمات'}
        </button>
      </div>
    </div>
  );
}

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">{title}</p>
      <div>{children}</div>
    </div>
  );
}

function ColorSwatch({ color, selected, onSelect }: { color: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-8 h-8 rounded-lg border-2 transition-all flex items-center justify-center ${selected ? 'border-teal-500 scale-110' : 'border-gray-200 dark:border-gray-700 hover:scale-105'}`}
      style={{ backgroundColor: color }}
    >
      {selected && <Check className="w-3 h-3 text-teal-600" />}
    </button>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{label}:</label>
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer"
      />
      <span className="text-xs text-gray-400 font-mono">{value}</span>
    </div>
  );
}

function BackgroundPreview({ style }: { style: 'dots' | 'lines' | 'plain' | 'gradient' }) {
  const base = 'w-full h-10 rounded-lg';
  if (style === 'dots') return (
    <div className={base} style={{ backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)', backgroundSize: '8px 8px', backgroundColor: '#f9fafb' }} />
  );
  if (style === 'lines') return (
    <div className={base} style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 7px, #e5e7eb 7px, #e5e7eb 8px)', backgroundColor: '#f9fafb' }} />
  );
  if (style === 'plain') return (
    <div className={`${base} bg-gray-100 dark:bg-gray-700`} />
  );
  return (
    <div className={base} style={{ background: 'linear-gradient(135deg, #f0fdf4, #ecfdf5)' }} />
  );
}
