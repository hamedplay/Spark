import React from 'react';
import { GitBranch, X, Circle, MessageSquare } from 'lucide-react';
import { type ChatConversation, type Profile } from './types';
import { toJalaliTime } from './utils';

function ChatFlowModal({ conv, profiles, onClose }: {
  conv: ChatConversation; profiles: Profile[]; onClose: () => void;
}) {
  const getProfile = (uid: string | null) => uid ? (profiles.find(p => p.user_id === uid)?.full_name || uid.slice(0, 8)) : null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">فلوچارت مکالمه</h3>
              <p className="text-xs text-gray-400 truncate max-w-xs">{conv.name || 'مکالمه مستقیم'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-0">
          {[
            { label: 'ایجاد مکالمه', date: conv.created_at, actor: getProfile(conv.creator_id), icon: Circle, color: 'bg-blue-500', done: true },
            { label: 'آخرین پیام', date: conv.last_message_at, actor: null, icon: MessageSquare, color: conv.last_message_at ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600', done: !!conv.last_message_at },
          ].map((ev, i) => {
            const Icon = ev.icon;
            return (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${ev.done ? ev.color : 'bg-gray-200 dark:bg-gray-700'}`}>
                    <Icon className={`w-4 h-4 ${ev.done ? 'text-white' : 'text-gray-400'}`} />
                  </div>
                  {i < 1 && <div className={`w-0.5 flex-1 my-1 rounded-full ${ev.done ? 'bg-teal-300 dark:bg-teal-700' : 'bg-gray-200 dark:bg-gray-700'}`} style={{ minHeight: '32px' }} />}
                </div>
                <div className="pb-5 flex-1">
                  <p className={`font-semibold text-sm ${ev.done ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>{ev.label}</p>
                  {ev.date && <p className="text-xs text-gray-500 mt-0.5">{toJalaliTime(ev.date)}</p>}
                  {ev.actor && <p className="text-xs text-blue-500 mt-0.5">توسط: {ev.actor}</p>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Messages */}
        {conv.messages && conv.messages.length > 0 && (
          <div className="border-t border-gray-100 dark:border-gray-700 flex-1 overflow-y-auto">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-5 py-2">آخرین پیام‌ها</p>
            <div className="space-y-1 px-5 pb-4">
              {conv.messages.map(msg => (
                <div key={msg.id} className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-600 dark:text-blue-400">
                    {(msg.sender_name || '?')[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{msg.sender_name || '—'}</span>
                      <span className="text-xs text-gray-400">{toJalaliTime(msg.created_at)}</span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-gray-100 dark:border-gray-700 px-5 py-3 space-y-2 flex-shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-1">نوع مکالمه</p>
              <p className="text-sm font-bold text-gray-800 dark:text-white">{conv.type === 'direct' ? 'مستقیم' : conv.type === 'group' ? 'گروهی' : conv.type}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-1">تعداد پیام</p>
              <p className="text-sm font-bold text-gray-800 dark:text-white">{conv.message_count ?? '—'}</p>
            </div>
          </div>
          {conv.participant_ids && conv.participant_ids.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1.5">شرکت‌کنندگان ({conv.participant_ids.length} نفر)</p>
              <div className="flex flex-wrap gap-1.5">
                {conv.participant_ids.map(uid => (
                  <span key={uid} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs">
                    {getProfile(uid) || uid.slice(0, 8)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { ChatFlowModal };
