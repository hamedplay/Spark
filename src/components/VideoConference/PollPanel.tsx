import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart2, Loader2, Trash2, X, Check, Download, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { ConferencePoll } from './types';

const MAX_OPTIONS = 10;
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

export function PollPanel({ roomId, userId, isHost }: PollPanelProps) {
  const [polls, setPolls] = useState<ConferencePoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [votingPollId, setVotingPollId] = useState<string | null>(null);
  const [expandedVoters, setExpandedVoters] = useState<string | null>(null);
  const [voterMap, setVoterMap] = useState<Record<string, VoterInfo[]>>({});
  const pollIdsRef = useRef<string[]>([]);

  // ── Initial load: single bulk query, no N+1 ───────────────────────────────
  const loadPolls = useCallback(async () => {
    try {
      const { data: pData, error: pErr } = await supabase
        .from('conference_polls')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false });
      if (pErr) throw pErr;
      if (!pData?.length) { setPolls([]); setLoading(false); return; }

      const ids = pData.map(p => p.id);
      pollIdsRef.current = ids;

      const { data: allVotes, error: vErr } = await supabase
        .from('conference_poll_votes')
        .select('poll_id, option_index, user_id')
        .in('poll_id', ids);
      if (vErr) throw vErr;

      const votesByPoll: Record<string, { counts: Record<number, number>; myVote: number | null }> = {};
      ids.forEach(id => { votesByPoll[id] = { counts: {}, myVote: null }; });

      (allVotes || []).forEach(v => {
        if (!votesByPoll[v.poll_id]) return;
        votesByPoll[v.poll_id].counts[v.option_index] = (votesByPoll[v.poll_id].counts[v.option_index] || 0) + 1;
        if (v.user_id === userId) votesByPoll[v.poll_id].myVote = v.option_index;
      });

      setPolls(pData.map(p => ({
        ...p,
        options: p.options as string[],
        votes: votesByPoll[p.id].counts,
        my_vote: votesByPoll[p.id].myVote,
      })));
    } catch (e) {
      console.error('loadPolls error:', e);
      toast.error('خطا در بارگذاری نظرسنجی‌ها');
    } finally {
      setLoading(false);
    }
  }, [roomId, userId]);

  // ── Realtime: incremental updates instead of full reloads ─────────────────
  useEffect(() => {
    loadPolls();

    const ch = supabase.channel(`polls-${roomId}`)
      // Poll INSERT → prepend to list
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'conference_polls',
        filter: `room_id=eq.${roomId}`,
      }, ({ new: row }) => {
        const poll: ConferencePoll = {
          ...row as ConferencePoll,
          options: row.options as string[],
          votes: {},
          my_vote: null,
        };
        setPolls(prev => [poll, ...prev]);
        pollIdsRef.current = [row.id, ...pollIdsRef.current];
      })
      // Poll UPDATE (close) → patch is_active + ended_at in place
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'conference_polls',
        filter: `room_id=eq.${roomId}`,
      }, ({ new: row }) => {
        setPolls(prev => prev.map(p =>
          p.id === row.id ? { ...p, is_active: row.is_active, ended_at: row.ended_at } : p
        ));
      })
      // Poll DELETE → remove from list
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'conference_polls',
        filter: `room_id=eq.${roomId}`,
      }, ({ old: row }) => {
        setPolls(prev => prev.filter(p => p.id !== row.id));
        pollIdsRef.current = pollIdsRef.current.filter(id => id !== row.id);
      })
      // Vote INSERT → increment the right option; skip own votes (already optimistic)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'conference_poll_votes',
      }, ({ new: row }) => {
        if (!pollIdsRef.current.includes(row.poll_id)) return;
        if (row.user_id === userId) return; // optimistic update already applied
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

  // ── Validation ────────────────────────────────────────────────────────────
  const validatePoll = (): string | null => {
    if (!question.trim()) return 'سوال نمی‌تواند خالی باشد';
    if (question.length > MAX_QUESTION_LEN) return `سوال نباید بیشتر از ${MAX_QUESTION_LEN} کاراکتر باشد`;
    const filled = options.filter(o => o.trim());
    if (filled.length < 2) return 'حداقل ۲ گزینه لازم است';
    if (filled.length > MAX_OPTIONS) return `حداکثر ${MAX_OPTIONS} گزینه مجاز است`;
    const unique = new Set(filled.map(o => o.trim().toLowerCase()));
    if (unique.size < filled.length) return 'گزینه‌های تکراری مجاز نیستند';
    if (polls.length >= MAX_POLLS_PER_ROOM) return `حداکثر ${MAX_POLLS_PER_ROOM} نظرسنجی در هر اتاق مجاز است`;
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
      console.error('createPoll error:', e);
      toast.error('خطا در ایجاد نظرسنجی: ' + (e.message || ''));
    } finally {
      setCreating(false);
    }
  };

  // ── Optimistic vote with race condition guard ─────────────────────────────
  const vote = async (poll: ConferencePoll, optionIndex: number) => {
    if (poll.my_vote != null || votingPollId === poll.id) return;
    setVotingPollId(poll.id);

    setPolls(prev => prev.map(p => {
      if (p.id !== poll.id) return p;
      const counts = { ...(p.votes || {}) };
      counts[optionIndex] = (counts[optionIndex] || 0) + 1;
      return { ...p, votes: counts, my_vote: optionIndex };
    }));

    try {
      const { error } = await supabase.from('conference_poll_votes').insert({
        poll_id: poll.id, user_id: userId, option_index: optionIndex,
      });
      if (error) {
        // Rollback optimistic update
        setPolls(prev => prev.map(p => {
          if (p.id !== poll.id) return p;
          const counts = { ...(p.votes || {}) };
          counts[optionIndex] = Math.max(0, (counts[optionIndex] || 1) - 1);
          return { ...p, votes: counts, my_vote: null };
        }));
        // 23505 = unique_violation (DB unique constraint enforces one vote per user)
        if (error.code === '23505') {
          toast('شما قبلاً در این نظرسنجی رأی داده‌اید');
        } else {
          throw error;
        }
      }
    } catch (e: any) {
      console.error('vote error:', e);
      toast.error('خطا در ثبت رأی');
    } finally {
      setVotingPollId(null);
    }
  };

  const closePoll = async (pollId: string) => {
    try {
      const { error } = await supabase.from('conference_polls')
        .update({ is_active: false, ended_at: new Date().toISOString() })
        .eq('id', pollId);
      if (error) throw error;
      toast.success('نظرسنجی بسته شد');
    } catch (e: any) {
      toast.error('خطا در بستن نظرسنجی: ' + (e.message || ''));
    }
  };

  const deletePoll = async (pollId: string) => {
    try {
      const { error } = await supabase.from('conference_polls')
        .delete().eq('id', pollId);
      if (error) throw error;
      toast.success('نظرسنجی حذف شد');
    } catch (e: any) {
      toast.error('خطا در حذف نظرسنجی: ' + (e.message || ''));
    }
  };

  // ── Batch voter load: one DB round-trip for all uncached polls ────────────
  const loadVoters = async (pollId: string) => {
    if (expandedVoters === pollId) { setExpandedVoters(null); return; }
    setExpandedVoters(pollId);
    if (voterMap[pollId]) return;

    // Load all polls not yet in cache in one batch
    const missingIds = pollIdsRef.current.filter(id => !voterMap[id]);
    if (!missingIds.length) return;

    try {
      const { data: votes, error: vErr } = await supabase
        .from('conference_poll_votes')
        .select('poll_id, user_id, option_index')
        .in('poll_id', missingIds);
      if (vErr) throw vErr;

      const userIds = [...new Set((votes || []).map(v => v.user_id))];
      const { data: parts } = userIds.length
        ? await supabase
            .from('conference_participants')
            .select('user_id, display_name')
            .eq('room_id', roomId)
            .in('user_id', userIds)
        : { data: [] };

      const nameMap: Record<string, string> = {};
      (parts || []).forEach(p => { nameMap[p.user_id] = p.display_name; });

      const grouped: Record<string, VoterInfo[]> = {};
      missingIds.forEach(id => { grouped[id] = []; });
      (votes || []).forEach(v => {
        if (grouped[v.poll_id]) {
          grouped[v.poll_id].push({
            user_id: v.user_id,
            display_name: nameMap[v.user_id] || 'ناشناس',
            option_index: v.option_index,
          });
        }
      });

      setVoterMap(prev => ({ ...prev, ...grouped }));
    } catch (e) {
      console.error('loadVoters error:', e);
      toast.error('خطا در بارگذاری رأی‌دهندگان');
    }
  };

  const exportCSV = (poll: ConferencePoll) => {
    const total = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
    const rows = [
      ['گزینه', 'تعداد رأی', 'درصد'],
      ...poll.options.map((opt, i) => {
        const cnt = poll.votes?.[i] || 0;
        const pct = total ? Math.round(cnt / total * 100) : 0;
        return [opt, cnt, `${pct}%`];
      }),
      ['مجموع', total, '100%'],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `poll-${poll.id.slice(0, 8)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const removeOption = (i: number) => {
    if (options.length <= 2) return;
    setOptions(o => o.filter((_, idx) => idx !== i));
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 gap-3" aria-label="پنل نظرسنجی">

      {isHost && (
        <button
          onClick={() => setShowCreate(v => !v)}
          aria-expanded={showCreate}
          className="w-full py-2 bg-teal-700 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          <BarChart2 className="w-4 h-4" /> نظرسنجی جدید
        </button>
      )}

      {showCreate && (
        <div className="bg-gray-800 rounded-xl p-3 space-y-2">
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
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>
          <p className="text-xs text-gray-400">گزینه‌ها <span className="text-gray-500">(حداکثر {MAX_OPTIONS})</span></p>
          {options.map((o, i) => (
            <div key={i} className="flex gap-1">
              <label htmlFor={`poll-opt-${i}`} className="sr-only">گزینه {i + 1}</label>
              <input
                id={`poll-opt-${i}`}
                value={o}
                onChange={e => { const a = [...options]; a[i] = e.target.value; setOptions(a); }}
                placeholder={`گزینه ${i + 1}`}
                className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm"
              />
              {options.length > 2 && (
                <button
                  onClick={() => removeOption(i)}
                  aria-label={`حذف گزینه ${i + 1}`}
                  className="p-2 text-gray-500 hover:text-red-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          {options.length < MAX_OPTIONS && (
            <button onClick={() => setOptions(o => [...o, ''])} className="text-teal-400 text-xs hover:text-teal-300 transition-colors">
              + گزینه جدید
            </button>
          )}
          <button
            onClick={createPoll}
            disabled={creating}
            className="w-full py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'ایجاد نظرسنجی'}
          </button>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
        </div>
      )}

      {!loading && polls.length === 0 && (
        <p className="text-center text-gray-500 text-sm py-8">هنوز نظرسنجی‌ای وجود ندارد</p>
      )}

      {polls.map(poll => {
        const total = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
        const isClosed = !poll.is_active;
        const isVoting = votingPollId === poll.id;

        return (
          <div key={poll.id} className={`bg-gray-800 rounded-xl p-3 transition-opacity ${isClosed ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-white text-sm font-medium leading-snug flex-1">{poll.question}</p>
              <div className="flex items-center gap-1 flex-shrink-0">
                {isClosed && (
                  <span className="text-xs bg-gray-700 text-gray-400 rounded-full px-2 py-0.5">بسته</span>
                )}
                {isHost && (
                  <>
                    {poll.is_active && (
                      <button
                        onClick={() => closePoll(poll.id)}
                        aria-label="بستن نظرسنجی"
                        title="بستن نظرسنجی"
                        className="p-1 text-gray-500 hover:text-amber-400 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => deletePoll(poll.id)}
                      aria-label="حذف نظرسنجی"
                      title="حذف نظرسنجی"
                      className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => exportCSV(poll)}
                      aria-label="خروجی CSV"
                      title="خروجی CSV"
                      className="p-1 text-gray-500 hover:text-teal-400 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-1.5" aria-live="polite" aria-label="نتایج نظرسنجی">
              {poll.options.map((opt, i) => {
                const cnt = poll.votes?.[i] || 0;
                const pct = total ? Math.round(cnt / total * 100) : 0;
                const isMyVote = poll.my_vote === i;
                const canVote = poll.my_vote == null && !isClosed && !isVoting;

                return (
                  <button
                    key={i}
                    onClick={() => canVote && vote(poll, i)}
                    disabled={!canVote}
                    aria-label={`رأی به گزینه "${opt}" — ${cnt} رأی، ${pct} درصد${isMyVote ? ' — انتخاب شما' : ''}`}
                    aria-pressed={isMyVote}
                    className={`w-full text-right rounded-lg overflow-hidden relative transition-all ${
                      isMyVote ? 'ring-2 ring-teal-400' :
                      canVote ? 'hover:opacity-80 cursor-pointer' :
                      'cursor-default'
                    }`}
                  >
                    <div
                      className="absolute inset-0 bg-teal-900/40 transition-all duration-500 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="relative flex justify-between items-center px-3 py-2 text-sm gap-2">
                      <span className="text-white flex items-center gap-1.5 truncate">
                        {isMyVote && <Check className="w-3 h-3 text-teal-400 flex-shrink-0" />}
                        {isVoting && poll.my_vote == null && i === 0 && (
                          <Loader2 className="w-3 h-3 animate-spin text-gray-400 flex-shrink-0" />
                        )}
                        {opt}
                      </span>
                      <span className="text-teal-300 text-xs font-mono flex-shrink-0">{pct}%</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between mt-1.5">
              <p className="text-gray-500 text-xs">
                {total} رأی
                {isClosed && poll.ended_at && (
                  <span className="mr-2 text-gray-600">
                    · بسته شد: {new Date(poll.ended_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </p>
              {isHost && total > 0 && (
                <button
                  onClick={() => loadVoters(poll.id)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  aria-label="مشاهده رأی‌دهندگان"
                >
                  <Users className="w-3 h-3" />
                  رأی‌دهندگان
                  {expandedVoters === poll.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              )}
            </div>

            {isHost && expandedVoters === poll.id && (
              <div className="mt-2 pt-2 border-t border-gray-700 space-y-1">
                {voterMap[poll.id] ? (
                  voterMap[poll.id].length === 0 ? (
                    <p className="text-xs text-gray-500">هنوز رأیی ثبت نشده</p>
                  ) : (
                    voterMap[poll.id].map((v, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="text-gray-300">{v.display_name}</span>
                        <span className="text-teal-400">{poll.options[v.option_index]}</span>
                      </div>
                    ))
                  )
                ) : (
                  <div className="flex justify-center py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
