import React, { useState, useEffect, useCallback } from 'react';
import { Bot, RefreshCw, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import toast from 'react-hot-toast';

import { AiSettingsPanel } from './SparkConfig/AiSettingsPanel';
import { ModuleCard } from './SparkConfig/ModuleCard';
import { SparkVisibilityToggle } from './SparkConfig/SparkVisibilityToggle';
import type { SparkModuleConfig, FieldKeyword } from './SparkConfig/types';
import { Spinner } from './SparkConfig/constants';

export function SparkConfigPanel() {
  const [configs, setConfigs] = useState<SparkModuleConfig[]>([]);
  const [fieldKeywords, setFieldKeywords] = useState<FieldKeyword[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: cfg }, { data: fk }] = await Promise.all([
        supabase.from('spark_config').select('*').order('module'),
        supabase.from('spark_field_keywords').select('*').order('module').order('sort_order'),
      ]);
      setConfigs((cfg || []) as SparkModuleConfig[]);
      setFieldKeywords((fk || []) as FieldKeyword[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveModule = async (updated: SparkModuleConfig) => {
    const { error } = await supabase.from('spark_config').update({
      enabled: updated.enabled,
      trigger_keywords: updated.trigger_keywords,
      description: updated.description,
      voice_response_template: updated.voice_response_template,
      updated_at: new Date().toISOString(),
    }).eq('id', updated.id);
    if (error) { toast.error('خطا: ' + error.message); return; }
    toast.success('تنظیمات ذخیره شد — اسپارک از دستور بعدی از تنظیمات جدید استفاده می‌کند');
    fetchAll();
  };

  const refreshFields = useCallback(() => {
    supabase.from('spark_field_keywords').select('*').order('module').order('sort_order').then(({ data }) => {
      setFieldKeywords((data || []) as FieldKeyword[]);
    });
  }, []);

  const enabledCount = configs.filter(c => c.enabled).length;
  const totalKws = configs.reduce((s, c) => s + c.trigger_keywords.length, 0);
  const totalFields = fieldKeywords.length;

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Spinner className="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #0ea5e9, #2563eb)' }}>
        <div className="px-5 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
              <Bot className="w-7 h-7 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white text-lg">پیکربندی دستیار اسپارک</h3>
              <p className="text-blue-100 text-xs">مدیریت ماژول‌ها، کلیدواژه‌ها و نگاشت فیلدها</p>
            </div>
            <button onClick={fetchAll} className="mr-auto w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors" title="بارگذاری مجدد">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'ماژول فعال', value: `${enabledCount}/${configs.length}` },
              { label: 'کلیدواژه شما', value: totalKws },
              { label: 'نگاشت فیلد', value: totalFields },
            ].map(s => (
              <div key={s.label} className="bg-white/15 backdrop-blur-sm rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-blue-100 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Spark visibility toggle */}
      <SparkVisibilityToggle />

      {/* AI Settings */}
      <AiSettingsPanel />

      {/* How it works */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed space-y-1">
          <p className="font-semibold">نحوه تاثیر تنظیمات بر رفتار اسپارک</p>
          <p><strong>غیرفعال کردن ماژول:</strong> اسپارک به هیچ دستوری در آن ماژول پاسخ نمی‌دهد، حتی اگر کلیدواژه مطابقت داشته باشد.</p>
          <p><strong>کلیدواژه فراخوان:</strong> کلیدواژه‌های شما امتیاز ۲ دارند در برابر امتیاز ۱ عبارات پیش‌فرض — دستوراتی که با کلیدواژه‌های شما مطابقت دارند قوی‌تر تشخیص داده می‌شوند.</p>
          <p><strong>نگاشت فیلد:</strong> اسپارک برای استخراج اطلاعات از دستور از این نگاشت‌ها استفاده می‌کند و فرم را پر می‌کند.</p>
          <p><strong>تغییرات فوری:</strong> بعد از ذخیره، دستور بعدی که به اسپارک می‌دهید از تنظیمات جدید استفاده می‌کند.</p>
        </div>
      </div>

      {/* Module cards */}
      <div className="space-y-3">
        {configs.map(c => (
          <ModuleCard
            key={c.id}
            config={c}
            fieldKeywords={fieldKeywords}
            onSave={saveModule}
            onRefreshFields={refreshFields}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <span>{totalFields} نگاشت فیلد | {totalKws} کلیدواژه سفارشی</span>
        <button onClick={fetchAll} className="flex items-center gap-1 hover:text-blue-500 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> بارگذاری مجدد
        </button>
      </div>
    </div>
  );
}
