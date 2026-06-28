import React, { useState, useEffect, useCallback } from 'react';
import { BarChart2, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { ConferencePoll } from './types';

interface PollPanelProps {
  roomId: string;
  userId: string;
  isHost: boolean;
}

export function PollPanel({ roomId, userId, isHost }: PollPanelProps) {
  const [polls, setPolls] = useState<ConferencePoll[]>([]);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const loadPolls = useCallback(async () => {
    const { data: pData } = await supabase.from('conference_polls').select('*').eq('room_id', roomId).order('created_at', { ascending: false });
    if (!pData) return;
    const pollsWithVotes = await Promise.all(pData.map(async p => {
      const { data: votes } = await supabase.from('conference_poll_votes').select('option_index').eq('poll_id', p.id);
      const { data: myVote } = await supabase.from('conference_poll_votes').select('option_index').eq('poll_id', p.id).eq('user_id', userId).maybeSingle();
      const voteCounts: Record<number, number> = {};
      votes?.forEach(v => { voteCounts[v.option_index] = (voteCounts[v.option_index] || 0) + 1; });
      return { ...p, options: p.options as string[], votes: voteCounts, my_vote: myVote?.option_index ?? null };
    }));
    setPolls(pollsWithVotes);
  }, [roomId, userId]);

  useEffect(() => {
    loadPolls();
    const ch = supabase.channel(`polls-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_polls', filter: `room_id=eq.${roomId}` }, loadPolls)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conference_poll_votes' }, loadPolls)
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [roomId, loadPolls]);

  const createPoll = async () => {
    if (!question.trim() || options.filter(o => o.trim()).length < 2) {
      toast.error('سوال و حداقل ۲ گزینه لازم است');
      return;
    }
    setCreating(true);
    await supabase.from('conference_polls').insert({
      room_id: roomId, created_by: userId,
      question, options: options.filter(o => o.trim()),
    });
    setQuestion(''); setOptions(['', '']); setShowCreate(false); setCreating(false);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 gap-3">
      {isHost && (
        <button onClick={() => setShowCreate(v => !v)}
          className="w-full py-2 bg-teal-700 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2">
          <BarChart2 className="w-4 h-4" /> نظرسنجی جدید
        </button>
      )}
      {showCreate && (
        <div className="bg-gray-800 rounded-xl p-3 space-y-2">
          <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="سوال..."
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
          {options.map((o, i) => (
            <input key={i} value={o} onChange={e => { const a = [...options]; a[i] = e.target.value; setOptions(a); }}
              placeholder={`گزینه ${i + 1}`} className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
          ))}
          <button onClick={() => setOptions(o => [...o, ''])} className="text-teal-400 text-xs">+ گزینه جدید</button>
          <button onClick={createPoll} disabled={creating}
            className="w-full py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
            {creating ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'ایجاد'}
          </button>
        </div>
      )}
      {polls.map(poll => {
        const total = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
        return (
          <div key={poll.id} className="bg-gray-800 rounded-xl p-3">
            <p className="text-white text-sm font-medium mb-2">{poll.question}</p>
            <div className="space-y-1.5">
              {poll.options.map((opt, i) => {
                const cnt = poll.votes?.[i] || 0;
                const pct = total ? Math.round(cnt / total * 100) : 0;
                return (
                  <button key={i}
                    onClick={() => poll.my_vote == null && supabase.from('conference_poll_votes').insert({ poll_id: poll.id, user_id: userId, option_index: i }).then(() => loadPolls())}
                    className={`w-full text-right rounded-lg overflow-hidden relative transition-all ${poll.my_vote === i ? 'ring-2 ring-teal-400' : 'hover:opacity-80'}`}
                    disabled={poll.my_vote != null}>
                    <div className="absolute inset-0 bg-teal-900/40" style={{ width: `${pct}%` }} />
                    <div className="relative flex justify-between items-center px-3 py-2 text-sm">
                      <span className="text-white">{opt}</span>
                      <span className="text-teal-300 text-xs font-mono">{pct}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-gray-500 text-xs mt-1.5">{total} رای</p>
          </div>
        );
      })}
      {polls.length === 0 && (
        <p className="text-center text-gray-500 text-sm py-8">هنوز نظرسنجی‌ای وجود ندارد</p>
      )}
    </div>
  );
}
