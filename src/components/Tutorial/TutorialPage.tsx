import { useState } from 'react';
import { BookOpen, Search, X, LayoutGrid, Sparkles, Bot, Zap } from 'lucide-react';
import { SECTIONS } from './sections';
import type { GuideSection } from './types';

interface TutorialPageProps {
  onAskSpark?: (command: string) => void;
}

const colorClasses: Record<string, { bg: string; text: string; lightBg: string; border: string; dot: string; badge: string }> = {
  blue: { bg: 'bg-blue-600', text: 'text-blue-600 dark:text-blue-300', lightBg: 'bg-blue-50 dark:bg-blue-500/10', border: 'border-blue-100 dark:border-blue-500/20', dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' },
  teal: { bg: 'bg-cyan-600', text: 'text-cyan-600 dark:text-cyan-300', lightBg: 'bg-cyan-50 dark:bg-cyan-500/10', border: 'border-cyan-100 dark:border-cyan-500/20', dot: 'bg-cyan-500', badge: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300' },
  green: { bg: 'bg-emerald-600', text: 'text-emerald-600 dark:text-emerald-300', lightBg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-100 dark:border-emerald-500/20', dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
  purple: { bg: 'bg-violet-600', text: 'text-violet-600 dark:text-violet-300', lightBg: 'bg-violet-50 dark:bg-violet-500/10', border: 'border-violet-100 dark:border-violet-500/20', dot: 'bg-violet-500', badge: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300' },
  orange: { bg: 'bg-amber-600', text: 'text-amber-600 dark:text-amber-300', lightBg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-100 dark:border-amber-500/20', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' },
  yellow: { bg: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-300', lightBg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-100 dark:border-amber-500/20', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' },
  cyan: { bg: 'bg-cyan-600', text: 'text-cyan-600 dark:text-cyan-300', lightBg: 'bg-cyan-50 dark:bg-cyan-500/10', border: 'border-cyan-100 dark:border-cyan-500/20', dot: 'bg-cyan-500', badge: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300' },
  rose: { bg: 'bg-rose-600', text: 'text-rose-600 dark:text-rose-300', lightBg: 'bg-rose-50 dark:bg-rose-500/10', border: 'border-rose-100 dark:border-rose-500/20', dot: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' },
  indigo: { bg: 'bg-indigo-600', text: 'text-indigo-600 dark:text-indigo-300', lightBg: 'bg-indigo-50 dark:bg-indigo-500/10', border: 'border-indigo-100 dark:border-indigo-500/20', dot: 'bg-indigo-500', badge: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' },
  sky: { bg: 'bg-sky-600', text: 'text-sky-600 dark:text-sky-300', lightBg: 'bg-sky-50 dark:bg-sky-500/10', border: 'border-sky-100 dark:border-sky-500/20', dot: 'bg-sky-500', badge: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' },
  slate: { bg: 'bg-slate-600', text: 'text-slate-600 dark:text-slate-300', lightBg: 'bg-slate-50 dark:bg-slate-800', border: 'border-slate-200 dark:border-slate-700', dot: 'bg-slate-500', badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  red: { bg: 'bg-rose-600', text: 'text-rose-600 dark:text-rose-300', lightBg: 'bg-rose-50 dark:bg-rose-500/10', border: 'border-rose-100 dark:border-rose-500/20', dot: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' },
};

export function TutorialPage({ onAskSpark }: TutorialPageProps) {
  const [activeId, setActiveId] = useState('meetings');
  const [searchQuery, setSearchQuery] = useState('');

  const activeSection = SECTIONS.find(section => section.id === activeId) || SECTIONS[0];
  const query = searchQuery.trim();
  const filtered = query
    ? SECTIONS.filter(section =>
        section.title.includes(query) ||
        section.overview.includes(query) ||
        section.icons.some(item => item.name.includes(query) || item.desc.includes(query)) ||
        section.steps.some(step => step.title.includes(query) || step.items.some(item => item.includes(query)))
      )
    : SECTIONS;

  const displayedSections = query ? filtered : [activeSection];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950" dir="rtl">
      <header className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-white/95 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/95 sm:px-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-sm">
            <BookOpen className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-sm font-bold text-slate-900 dark:text-white">راهنمای جامع سامانه</h1>
            <p className="text-[10px] text-slate-400">راهنمای کاربردی بخش‌ها، آیکن‌ها و جریان‌های اصلی</p>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="جستجو در راهنما..."
            className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-8 text-[11px] text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className="absolute left-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row-reverse">
        <aside className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-900/60 md:w-52 md:flex-col md:overflow-y-auto md:border-b-0 md:border-l">
          {(query ? filtered : SECTIONS).map(section => {
            const Icon = section.icon;
            const colors = colorClasses[section.color] || colorClasses.blue;
            const active = activeId === section.id && !query;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => { setActiveId(section.id); setSearchQuery(''); }}
                className={`flex flex-shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-right transition md:w-full ${active
                  ? `${colors.lightBg} ${colors.text} ring-1 ring-inset ${colors.border}`
                  : 'bg-white text-slate-500 hover:bg-violet-50 hover:text-violet-700 dark:bg-slate-950 dark:text-slate-400 dark:hover:bg-violet-500/10 dark:hover:text-violet-300'}`}
              >
                <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${active ? colors.lightBg : 'bg-slate-50 dark:bg-slate-800'}`}>
                  <Icon className={`h-3.5 w-3.5 ${active ? colors.text : 'text-slate-400'}`} />
                </span>
                <span className="whitespace-nowrap text-[11px] font-bold md:truncate">{section.title}</span>
              </button>
            );
          })}
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/35 p-2.5 dark:bg-slate-950 sm:p-3">
          {query && filtered.length === 0 && (
            <div className="flex min-h-[260px] flex-col items-center justify-center text-slate-400">
              <Search className="mb-2 h-7 w-7 opacity-40" />
              <p className="text-xs font-bold">نتیجه‌ای یافت نشد</p>
            </div>
          )}

          <div className="space-y-3">
            {displayedSections.map((section: GuideSection) => {
              const SectionIcon = section.icon;
              const colors = colorClasses[section.color] || colorClasses.blue;
              return (
                <article key={section.id} className="space-y-3">
                  <div className={`rounded-xl bg-gradient-to-r ${section.gradient} px-3.5 py-3 text-white shadow-sm`}>
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/18">
                        <SectionIcon className="h-4 w-4" />
                      </span>
                      <div>
                        <h2 className="text-sm font-bold">{section.title}</h2>
                        <p className="mt-0.5 text-[10px] leading-5 text-white/80">{section.overview}</p>
                      </div>
                    </div>
                  </div>

                  <section className={`overflow-hidden rounded-xl border bg-white dark:bg-slate-900 ${colors.border}`}>
                    <div className={`flex items-center gap-2 border-b px-3 py-2 ${colors.lightBg} ${colors.border}`}>
                      <LayoutGrid className={`h-3.5 w-3.5 ${colors.text}`} />
                      <h3 className={`text-[11px] font-bold ${colors.text}`}>راهنمای آیکن‌ها</h3>
                    </div>
                    <div className="grid gap-px bg-slate-100 dark:bg-slate-800 sm:grid-cols-2 xl:grid-cols-3">
                      {section.icons.map((item, index) => {
                        const ItemIcon = item.icon;
                        return (
                          <div key={index} className="flex items-start gap-2 bg-white p-2.5 dark:bg-slate-900">
                            <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${colors.lightBg}`}>
                              <ItemIcon className={`h-3.5 w-3.5 ${item.color || colors.text}`} />
                            </span>
                            <div className="min-w-0">
                              <p className="text-[11px] font-bold text-slate-800 dark:text-white">{item.name}</p>
                              <p className="mt-0.5 text-[10px] leading-4 text-slate-500 dark:text-slate-400">{item.desc}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <div className="grid gap-2.5 lg:grid-cols-2">
                    {section.steps.map((step, stepIndex) => (
                      <section key={stepIndex} className={`overflow-hidden rounded-xl border bg-white dark:bg-slate-900 ${colors.border}`}>
                        <div className={`border-b px-3 py-2 ${colors.lightBg} ${colors.border}`}>
                          <h3 className={`text-[11px] font-bold ${colors.text}`}>{step.title}</h3>
                        </div>
                        <ol className="space-y-2 p-3">
                          {step.items.map((item, itemIndex) => (
                            <li key={itemIndex} className="flex items-start gap-2">
                              <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white ${colors.bg}`}>{itemIndex + 1}</span>
                              <span className="text-[11px] leading-5 text-slate-600 dark:text-slate-300">{item}</span>
                            </li>
                          ))}
                        </ol>
                      </section>
                    ))}
                  </div>

                  {section.tips.length > 0 && (
                    <section className={`rounded-xl border bg-white p-3 dark:bg-slate-900 ${colors.border}`}>
                      <div className="mb-2 flex items-center gap-1.5">
                        <Sparkles className={`h-3.5 w-3.5 ${colors.text}`} />
                        <h3 className={`text-[11px] font-bold ${colors.text}`}>نکات کلیدی</h3>
                      </div>
                      <div className="grid gap-1.5 md:grid-cols-2">
                        {section.tips.map((tip, index) => (
                          <div key={index} className="flex items-start gap-2 text-[10px] leading-5 text-slate-600 dark:text-slate-300">
                            <span className={`mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full ${colors.dot}`} />
                            {tip}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {onAskSpark && section.sparkQuestions.length > 0 && (
                    <section className="rounded-xl border border-indigo-100 bg-gradient-to-r from-violet-50 to-indigo-50 p-3 dark:border-indigo-500/20 dark:from-violet-500/10 dark:to-indigo-500/10">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
                          <Bot className="h-3.5 w-3.5" />
                        </span>
                        <div>
                          <h3 className="text-[11px] font-bold text-indigo-800 dark:text-indigo-200">بپرس از اسپارک</h3>
                          <p className="text-[9px] text-indigo-500 dark:text-indigo-300">سؤال آماده را برای دستیار ارسال کنید.</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {section.sparkQuestions.map((question, index) => (
                          <button key={index} type="button" onClick={() => onAskSpark(question)}
                            className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 text-[10px] font-bold text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-50 dark:border-indigo-500/20 dark:bg-slate-900 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
                            <Zap className="h-3 w-3" />
                            {question}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </article>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}
