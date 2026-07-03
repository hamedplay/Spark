import { useState } from 'react';
import {
  BookOpen, Search, X, LayoutGrid, Sparkles, Bot, Zap,
} from 'lucide-react';
import { SECTIONS } from './TutorialSections';
import type { GuideSection } from './TutorialSections';

interface TutorialPageProps {
  onAskSpark?: (command: string) => void;
}

const colorClasses: Record<string, {
  bg: string; text: string; lightBg: string; border: string; dot: string; badge: string
}> = {
  blue:   { bg: 'bg-blue-600',   text: 'text-blue-600 dark:text-blue-400',   lightBg: 'bg-blue-50 dark:bg-blue-900/20',   border: 'border-blue-200 dark:border-blue-800',   dot: 'bg-blue-500',   badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  teal:   { bg: 'bg-teal-600',   text: 'text-teal-600 dark:text-teal-400',   lightBg: 'bg-teal-50 dark:bg-teal-900/20',   border: 'border-teal-200 dark:border-teal-800',   dot: 'bg-teal-500',   badge: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300' },
  green:  { bg: 'bg-green-600',  text: 'text-green-600 dark:text-green-400', lightBg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-800', dot: 'bg-green-500', badge: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
  purple: { bg: 'bg-purple-600', text: 'text-purple-600 dark:text-purple-400', lightBg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800', dot: 'bg-purple-500', badge: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
  orange: { bg: 'bg-orange-600', text: 'text-orange-600 dark:text-orange-400', lightBg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800', dot: 'bg-orange-500', badge: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' },
  yellow: { bg: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400', lightBg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-800', dot: 'bg-yellow-500', badge: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' },
  cyan:   { bg: 'bg-cyan-600',   text: 'text-cyan-600 dark:text-cyan-400',   lightBg: 'bg-cyan-50 dark:bg-cyan-900/20',   border: 'border-cyan-200 dark:border-cyan-800',   dot: 'bg-cyan-500',   badge: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300' },
  rose:   { bg: 'bg-rose-600',   text: 'text-rose-600 dark:text-rose-400',   lightBg: 'bg-rose-50 dark:bg-rose-900/20',   border: 'border-rose-200 dark:border-rose-800',   dot: 'bg-rose-500',   badge: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' },
  indigo: { bg: 'bg-sky-600',    text: 'text-sky-600 dark:text-sky-400',     lightBg: 'bg-sky-50 dark:bg-sky-900/20',     border: 'border-sky-200 dark:border-sky-800',     dot: 'bg-sky-500',    badge: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
  sky:    { bg: 'bg-sky-600',    text: 'text-sky-600 dark:text-sky-400',     lightBg: 'bg-sky-50 dark:bg-sky-900/20',     border: 'border-sky-200 dark:border-sky-800',     dot: 'bg-sky-500',    badge: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
  slate:  { bg: 'bg-slate-600',  text: 'text-slate-600 dark:text-slate-400', lightBg: 'bg-slate-50 dark:bg-slate-900/20', border: 'border-slate-200 dark:border-slate-700', dot: 'bg-slate-500', badge: 'bg-slate-100 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300' },
  red:    { bg: 'bg-red-600',    text: 'text-red-600 dark:text-red-400',     lightBg: 'bg-red-50 dark:bg-red-900/20',     border: 'border-red-200 dark:border-red-800',     dot: 'bg-red-500',    badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
};

export function TutorialPage({ onAskSpark }: TutorialPageProps) {
  const [activeId, setActiveId] = useState<string>('meetings');
  const [searchQuery, setSearchQuery] = useState('');

  const activeSection = SECTIONS.find(s => s.id === activeId) || SECTIONS[0];

  const filtered = searchQuery.trim()
    ? SECTIONS.filter(s =>
        s.title.includes(searchQuery) ||
        s.overview.includes(searchQuery) ||
        s.icons.some(i => i.name.includes(searchQuery) || i.desc.includes(searchQuery)) ||
        s.steps.some(st => st.title.includes(searchQuery) || st.items.some(it => it.includes(searchQuery)))
      )
    : SECTIONS;

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-400 to-sky-500 flex items-center justify-center shadow-md">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">راهنمای جامع سامانه</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">آموزش آیکن به آیکن تمام بخش‌ها</p>
            </div>
          </div>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="جستجو در راهنما..."
              className="w-full pr-9 pl-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute left-2 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-l border-gray-100 dark:border-gray-700 overflow-y-auto">
          <div className="p-2 space-y-0.5">
            {(searchQuery ? filtered : SECTIONS).map(section => {
              const Icon = section.icon;
              const sc = colorClasses[section.color] || colorClasses.blue;
              const isActive = activeId === section.id && !searchQuery;
              return (
                <button
                  key={section.id}
                  onClick={() => { setActiveId(section.id); setSearchQuery(''); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-right transition-all ${
                    isActive
                      ? `${sc.lightBg} ${sc.text} font-semibold`
                      : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? sc.lightBg : 'bg-white dark:bg-gray-800'}`}>
                    <Icon className={`w-4 h-4 ${isActive ? sc.text : 'text-gray-400 dark:text-gray-500'}`} />
                  </div>
                  <span className="text-sm truncate">{section.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {searchQuery && filtered.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>نتیجه‌ای یافت نشد</p>
            </div>
          )}

          {(searchQuery ? filtered : [activeSection]).map((section: GuideSection) => {
            const SectionIcon = section.icon;
            const sc = colorClasses[section.color] || colorClasses.blue;
            return (
              <div key={section.id}>
                <div className={`rounded-2xl p-5 mb-5 bg-gradient-to-r ${section.gradient} text-white shadow-md`}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                      <SectionIcon className="w-6 h-6 text-white" />
                    </div>
                    <h2 className="text-xl font-bold">{section.title}</h2>
                  </div>
                  <p className="text-sm text-white/85 leading-relaxed">{section.overview}</p>
                </div>

                <div className={`bg-white dark:bg-gray-800 rounded-2xl border ${sc.border} overflow-hidden mb-5`}>
                  <div className={`px-4 py-3 ${sc.lightBg} border-b ${sc.border} flex items-center gap-2`}>
                    <LayoutGrid className={`w-4 h-4 ${sc.text}`} />
                    <h3 className={`text-sm font-bold ${sc.text}`}>راهنمای آیکن‌ها</h3>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-100 dark:bg-gray-700">
                    {section.icons.map((item, i) => {
                      const ItemIcon = item.icon;
                      return (
                        <div key={i} className="flex items-start gap-3 p-3.5 bg-white dark:bg-gray-800">
                          <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center ${sc.lightBg}`}>
                            <ItemIcon className={`w-4.5 h-4.5 ${item.color || sc.text}`} />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-800 dark:text-white leading-tight mb-0.5">{item.name}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{item.desc}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-5">
                  {section.steps.map((step, si) => (
                    <div key={si} className={`bg-white dark:bg-gray-800 rounded-2xl border ${sc.border} overflow-hidden`}>
                      <div className={`px-4 py-3 ${sc.lightBg} border-b ${sc.border}`}>
                        <h3 className={`text-sm font-bold ${sc.text}`}>{step.title}</h3>
                      </div>
                      <ul className="p-4 space-y-2.5">
                        {step.items.map((item, ii) => (
                          <li key={ii} className="flex items-start gap-2.5">
                            <span className={`mt-1.5 w-5 h-5 rounded-full text-[10px] font-bold flex-shrink-0 flex items-center justify-center text-white ${sc.bg}`}>{ii + 1}</span>
                            <span className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                {section.tips.length > 0 && (
                  <div className={`bg-white dark:bg-gray-800 rounded-2xl border ${sc.border} p-4 mb-5`}>
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className={`w-4 h-4 ${sc.text}`} />
                      <h3 className={`text-sm font-bold ${sc.text}`}>نکات کلیدی</h3>
                    </div>
                    <ul className="space-y-2">
                      {section.tips.map((tip, ti) => (
                        <li key={ti} className="flex items-start gap-2.5">
                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`} />
                          <span className="text-sm text-gray-700 dark:text-gray-300">{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {onAskSpark && section.sparkQuestions.length > 0 && (
                  <div className="bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 rounded-2xl border border-sky-200 dark:border-sky-800 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-sky-800 dark:text-sky-300">بپرس از اسپارک</h3>
                        <p className="text-[11px] text-sky-600 dark:text-sky-400">روی هر سوال کلیک کنید تا اسپارک جواب دهد</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {section.sparkQuestions.map((q, qi) => (
                        <button
                          key={qi}
                          onClick={() => onAskSpark(q)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-700 rounded-full text-xs font-medium hover:bg-sky-50 dark:hover:bg-sky-900/30 hover:border-sky-400 transition-all shadow-sm"
                        >
                          <Zap className="w-3 h-3" />
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
