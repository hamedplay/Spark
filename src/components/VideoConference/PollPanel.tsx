import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart2, Loader2, Trash2, X, Check, Download, ChevronDown, ChevronUp, Users, Lock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { ConferencePoll } from './types';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_QUESTION_LEN = 500;
const MAX_POLLS_PER_ROOM = 50;

interface PollPanelProps {
  roomId: string;
  userId: string;
  isHost: boolean;
}

interface VoterInfo {
  user_id: string;
  display_name?: string;
  option_index: number;
}

// ─── Progress bar for a single option ────────────────────────────────────────
function OptionBar({
  label, count, total, pct, isMyVote, canVote, isVoting, onVote,
}: {
  label: string; count: number; total: number; pct: number;
  isMyVote: boolean; canVote: boolean; isVoting: boolean;
  onVote: () => void;
}) {
  return (
    <button
      onClick={canVote ? onVote : undefined}
      disabled={!canVote && !isMyVote}
      aria-label={`${label} — ${count} رأی، ${pct} درصد${isMyVote ? ' — انتخاب شما' : ''}`}
      aria-pressed={isMyVote}
      className={`w-full text-right rounded-xl transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500
        ${isMyVote ? 'ring-2 ring-teal-400 bg-teal-900/20' : canVote ? 'hover:bg-gray-700/60 cursor-pointer bg-gray-700/30' : 'bg-gray-700/30 cursor-default'}
      `}
    >
      {/* Label row */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1 gap-2">
        <span className="text-sm text-white truncate flex items-center gap-1.5">
          {isMyVote && <Check className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />}
          {isVoting && !isMyVote && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 flex-shrink-0" />}
          {label}
        </span>
        <span className="text-xs text-gray-400 font-mono flex-shrink-0 tabular-nums">{count} رأی · {pct}٪</span>
      </div>
      {/* Progress bar */}
      <div className="mx-3 mb-2.5 h-1.5 bg-gray-600 rounded-full overflow-hidden">
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className={`h-full rounded-full transition-all duration-500 ease-out ${isMyVote ? 'bg-teal-400' : 'bg-teal-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function PollPanel({ roomId, userId, isHost }: PollPanelProps) {
  const [polls, setPolls] = useState<ConferencePoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [votingPollId, setVotingPollId] = useState<string | null>(null);
  const [closingPollId, setClosingPollId] = useState<string | null>(null);
  const [expandedVoters, setExpandedVoters] = useState<string | null>(null);
  const [voterMap, setVoterMap] = useState<Record<string, VoterInfo[]>>({});
  const pollIdsRef = useRef<string[]>([]);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadPolls = useCallback(async () => {
    try {
      const { data: pData, error: pErr } = await supabase
        .from('conference_polls').select('*').eq('room_id', roomId)
        .order('created_at', { ascending: false });
      if (pErr) throw pErr;
      if (!pData?.length) { setPolls([]); setLoading(false); return; }

      const ids = pData.map(p => p.id);
      pollIdsRef.current = ids;

      const { data: allVotes, error: vErr } = await supabase
        .from('conference_poll_votes').select('poll_id, option_index, user_id').in('poll_id', ids);
      if (vErr) throw vErr;

      const byPoll: Record<string, { counts: Record<number, number>; myVote: number | null }> = {};
      ids.forEach(id => { byPoll[id] = { counts: {}, myVote: null }; });
      (allVotes || []).forEach(v => {
        if (!byPoll[v.poll_id]) return;
        byPoll[v.poll_id].counts[v.option_index] = (byPoll[v.poll_id].counts[v.option_index] || 0) + 1;
        if (v.user_id === userId) byPoll[v.poll_id].myVote = v.option_index;
      });

      setPolls(pData.map(p => ({ ...p, options: p.options as string[], votes: byPoll[p.id].counts, my_vote: byPoll[p.id].myVote })));
    } catch (e) {
      console.error('loadPolls error:', e);
      toast.error('خطا در بارگذاری نظرسنجی‌ها');
    } finally { setLoading(false); }
  }, [roomId, userId]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    loadPolls();
    const ch = supabase.channel(`polls-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conference_polls', filter: `room_id=eq.${roomId}` },
        ({ new: row }) => {
          const poll: ConferencePoll = { ...row as ConferencePoll, options: row.options as string[], votes: {}, my_vote: null };
          setPolls(prev => [poll, ...prev]);
          pollIdsRef.current = [row.id, ...pollIdsRef.current];
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conference_polls', filter: `room_id=eq.${roomId}` },
        ({ new: row }) => setPolls(prev => prev.map(p => p.id === row.id ? { ...p, is_active: row.is_active, ended_at: row.ended_at } : p)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'conference_polls', filter: `room_id=eq.${roomId}` },
        ({ old: row }) => {
          setPolls(prev => prev.filter(p => p.id !== row.id));
          pollIdsRef.current = pollIdsRef.current.filter(id => id !== row.id);
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conference_poll_votes' },
        ({ new: row }) => {
          if (!pollIdsRef.current.includes(row.poll_id) || row.user_id === userId) return;
          setPolls(prev => prev.map(p => {
            if (p.id !== row.poll_id) return p;
            const counts = { ...(p.votes || {}) };
            counts[row.option_index] = (counts[row.option_index] || 0) + 1;
            return { ...p, votes: counts };
          }));
        })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [roomId, userId, loadPolls]);

  // ── Create ────────────────────────────────────────────────────────────────
  const validatePoll = (): string | null => {
    if (!question.trim()) return 'سوال نمی‌تواند خالی باشد';
    if (question.length > MAX_QUESTION_LEN) return `حداکثر ${MAX_QUESTION_LEN} کاراکتر`;
    const filled = options.filter(o => o.trim());
    if (filled.length < MIN_OPTIONS) return `حداقل ${MIN_OPTIONS} گزینه لازم است`;
    if (filled.length > MAX_OPTIONS) return `حداکثر ${MAX_OPTIONS} گزینه`;
    const unique = new Set(filled.map(o => o.trim().toLowerCase()));
    if (unique.size < filled.length) return 'گزینه‌های تکراری مجاز نیستند';
    if (polls.length >= MAX_POLLS_PER_ROOM) return `حداکثر ${MAX_POLLS_PER_ROOM} نظرسنجی در اتاق`;
    return null;
  };

  const createPoll = async () => {
    const err = validatePoll();
    if (err) { toast.error(err); return; }
    setCreating(true);
    try {
      const { error } = await supabase.from('conference_polls').insert({
        room_id: roomId, created_by: userId,
        question: question.trim(),
        options: options.filter(o => o.trim()),
        is_active: true,
      });
      if (error) throw error;
      setQuestion(''); setOptions(['', '']); setShowCreate(false);
      toast.success('نظرسنجی ایجاد شد');
    } catch (e: any) {
      toast.error('خطا در ایجاد نظرسنجی: ' + (e.message || ''));
    } finally { setCreating(false); }
  };

  // ── Vote (optimistic + rollback) ──────────────────────────────────────────
  const vote = async (poll: ConferencePoll, optionIndex: number) => {
    if (poll.my_vote != null || votingPollId === poll.id || !poll.is_active) return;
    setVotingPollId(poll.id);
    setPolls(prev => prev.map(p => {
      if (p.id !== poll.id) return p;
      const counts = { ...(p.votes || {}) };
      counts[optionIndex] = (counts[optionIndex] || 0) + 1;
      return { ...p, votes: counts, my_vote: optionIndex };
    }));
    try {
      const { error } = await supabase.from('conference_poll_votes').insert({
        poll_id: poll.id, room_id: roomId, user_id: userId, option_index: optionIndex,
      });
      if (error) {
        setPolls(prev => prev.map(p => {
          if (p.id !== poll.id) return p;
          const counts = { ...(p.votes || {}) };
          counts[optionIndex] = Math.max(0, (counts[optionIndex] || 1) - 1);
          return { ...p, votes: counts, my_vote: null };
        }));
        if (error.code === '23505') toast('شما قبلاً در این نظرسنجی رأی داده‌اید');
        else throw error;
      }
    } catch (e: any) {
      toast.error('خطا در ثبت رأی');
    } finally { setVotingPollId(null); }
  };

  // ── Close poll ────────────────────────────────────────────────────────────
  const closePoll = async (pollId: string) => {
    setClosingPollId(pollId);
    try {
      const { error } = await supabase.from('conference_polls')
        .update({ is_active: false, ended_at: new Date().toISOString() }).eq('id', pollId);
      if (error) throw error;
      toast.success('نظرسنجی بسته شد');
    } catch (e: any) {
      toast.error('خطا در بستن نظرسنجی');
    } finally { setClosingPollId(null); }
  };

  const deletePoll = async (pollId: string) => {
    try {
      const { error } = await supabase.from('conference_polls').delete().eq('id', pollId);
      if (error) throw error;
      toast.success('نظرسنجی حذف شد');
    } catch (e: any) { toast.error('خطا در حذف نظرسنجی'); }
  };

  // ── Voter details (host only) ─────────────────────────────────────────────
  const loadVoters = async (pollId: string) => {
    if (expandedVoters === pollId) { setExpandedVoters(null); return; }
    setExpandedVoters(pollId);
    if (voterMap[pollId]) return;
    const missing = pollIdsRef.current.filter(id => !voterMap[id]);
    if (!missing.length) return;
    try {
      const { data: votes, error: vErr } = await supabase
        .from('conference_poll_votes').select('poll_id, user_id, option_index').in('poll_id', missing);
      if (vErr) throw vErr;
      const userIds = [...new Set((votes || []).map(v => v.user_id))];
      const { data: parts } = userIds.length
        ? await supabase.from('conference_participants').select('user_id, display_name').eq('room_id', roomId).in('user_id', userIds)
        : { data: [] };
      const nameMap: Record<string, string> = {};
      (parts || []).forEach(p => { nameMap[p.user_id] = p.display_name; });
      const grouped: Record<string, VoterInfo[]> = {};
      missing.forEach(id => { grouped[id] = []; });
      (votes || []).forEach(v => { if (grouped[v.poll_id]) grouped[v.poll_id].push({ user_id: v.user_id, display_name: nameMap[v.user_id] || 'ناشناس', option_index: v.option_index }); });
      setVoterMap(prev => ({ ...prev, ...grouped }));
    } catch (e) { toast.error('خطا در بارگذاری رأی‌دهندگان'); }
  };

  const exportCSV = (poll: ConferencePoll) => {
    const total = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
    const rows = [['گزینه', 'تعداد رأی', 'درصد'], ...poll.options.map((opt, i) => { const cnt = poll.votes?.[i] || 0; return [opt, cnt, `${total ? Math.round(cnt / total * 100) : 0}%`]; }), ['مجموع', total, '100%']];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `poll-${poll.id.slice(0, 8)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 gap-3" aria-label="پنل نظرسنجی">

      {/* Create button — host/admin only */}
      {isHost && (
        <button onClick={() => setShowCreate(v => !v)} aria-expanded={showCreate}
          className="w-full py-2 bg-teal-700 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2">
          <BarChart2 className="w-4 h-4" />
          {showCreate ? 'انصراف' : 'نظرسنجی جدید'}
        </button>
      )}

      {/* Create form */}
      {showCreate && isHost && (
        <div className="bg-gray-800 rounded-xl p-3 space-y-2 border border-gray-700">
          <div>
            <label htmlFor="poll-question" className="block text-xs text-gray-400 mb-1">
              سوال <span className="text-gray-500">({question.length}/{MAX_QUESTION_LEN})</span>
            </label>
            <textarea
              id="poll-question"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="سوال نظرسنجی..."
              maxLength={MAX_QUESTION_LEN}
              rows={2}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm resize-none outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <p className="text-xs text-gray-400">
            گزینه‌ها
            <span className="text-gray-500 mr-1">({MIN_OPTIONS}–{MAX_OPTIONS} گزینه)</span>
          </p>
          <div className="space-y-1.5">
            {options.map((o, i) => (
              <div key={i} className="flex gap-1 items-center">
                <span className="text-xs text-gray-500 w-5 flex-shrink-0">{i + 1}</span>
                <input
                  value={o}
                  onChange={e => { const a = [...options]; a[i] = e.target.value; setOptions(a); }}
                  placeholder={`گزینه ${i + 1}`}
                  className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-teal-500"
                />
                {options.length > MIN_OPTIONS && (
                  <button onClick={() => setOptions(o => o.filter((_, idx) => idx !== i))}
                    aria-label={`حذف گزینه ${i + 1}`}
                    className="p-1.5 text-gray-500 hover:text-red-400 transition-colors flex-shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {options.length < MAX_OPTIONS && (
            <button onClick={() => setOptions(o => [...o, ''])}
              className="text-teal-400 text-xs hover:text-teal-300 transition-colors flex items-center gap-1">
              + افزودن گزینه
            </button>
          )}

          <button onClick={createPoll} disabled={creating}
            className="w-full py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><BarChart2 className="w-4 h-4" /> ایجاد نظرسنجی</>}
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-teal-500" /></div>}

      {/* Empty */}
      {!loading && polls.length === 0 && (
        <p className="text-center text-gray-500 text-sm py-8">هنوز نظرسنجی‌ای وجود ندارد</p>
      )}

      {/* Poll cards */}
      {polls.map(poll => {
        const total = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
        const isClosed = !poll.is_active;
        const isVoting = votingPollId === poll.id;
        const isClosing = closingPollId === poll.id;

        return (
          <div key={poll.id} className={`bg-gray-800 rounded-xl overflow-hidden border transition-all ${isClosed ? 'border-gray-700 opacity-70' : 'border-gray-700'}`}>
            {/* Header */}
            <div className="flex items-start justify-between gap-2 p-3 pb-2">
              <div className="flex-1 min-w-0">
                {isClosed && (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-gray-700 text-gray-400 rounded-full px-2 py-0.5 mb-1.5">
                    <Lock className="w-2.5 h-2.5" /> بسته
                  </span>
                )}
                <p className="text-white text-sm font-medium leading-snug">{poll.question}</p>
              </div>
              {isHost && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button onClick={() => exportCSV(poll)} aria-label="خروجی CSV" title="دانلود CSV"
                    className="p-1.5 text-gray-500 hover:text-teal-400 transition-colors rounded-lg hover:bg-gray-700">
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => deletePoll(poll.id)} aria-label="حذف نظرسنجی" title="حذف"
                    className="p-1.5 text-gray-500 hover:text-red-400 transition-colors rounded-lg hover:bg-gray-700">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Options with progress bars */}
            <div className="px-3 pb-2 space-y-1.5" aria-live="polite">
              {poll.options.map((opt, i) => {
                const cnt = poll.votes?.[i] || 0;
                const pct = total ? Math.round(cnt / total * 100) : 0;
                const isMyVote = poll.my_vote === i;
                const canVote = poll.my_vote == null && !isClosed && !isVoting;
                return (
                  <OptionBar
                    key={i}
                    label={opt}
                    count={cnt}
                    total={total}
                    pct={pct}
                    isMyVote={isMyVote}
                    canVote={canVote}
                    isVoting={isVoting}
                    onVote={() => vote(poll, i)}
                  />
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-gray-700/60">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs">{total} رأی</span>
                {isClosed && poll.ended_at && (
                  <span className="text-gray-600 text-xs">
                    · {new Date(poll.ended_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {/* Voters list toggle — host only */}
                {isHost && total > 0 && (
                  <button onClick={() => loadVoters(poll.id)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                    <Users className="w-3 h-3" />
                    {expandedVoters === poll.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                )}
                {/* End poll button — host only, active polls */}
                {isHost && poll.is_active && (
                  <button
                    onClick={() => closePoll(poll.id)}
                    disabled={isClosing}
                    aria-label="پایان نظرسنجی"
                    className="flex items-center gap-1 px-2 py-1 bg-amber-900/30 hover:bg-amber-900/50 text-amber-400 hover:text-amber-300 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {isClosing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
                    پایان نظرسنجی
                  </button>
                )}
              </div>
            </div>

            {/* Voter list — host only */}
            {isHost && expandedVoters === poll.id && (
              <div className="px-3 pb-3 pt-1 border-t border-gray-700/60 space-y-1">
                <p className="text-xs text-gray-500 font-medium mb-1.5">رأی‌دهندگان</p>
                {!voterMap[poll.id] ? (
                  <div className="flex justify-center py-1"><Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" /></div>
                ) : voterMap[poll.id].length === 0 ? (
                  <p className="text-xs text-gray-500">هنوز رأیی ثبت نشده</p>
                ) : (
                  voterMap[poll.id].map((v, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs py-0.5">
                      <span className="text-gray-300">{v.display_name}</span>
                      <span className="text-teal-400 bg-teal-900/20 rounded-full px-2 py-0.5">{poll.options[v.option_index]}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
