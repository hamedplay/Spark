import React, { useEffect, useRef, useState } from 'react';
import { ShieldOff, UserCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import moment from 'moment-jalaali';
import toast from 'react-hot-toast';

interface BannedUser {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  reason: string | null;
  banned_at: string; // ISO 8601
}

interface Props {
  roomId: string;
}

export function BanList({ roomId }: Props) {
  const [bans, setBans] = useState<BannedUser[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    const load = async () => {
      const { data } = await supabase
        .from('banned_users')
        .select('*')
        .eq('room_id', roomId)
        .order('banned_at', { ascending: false });
      if (isMountedRef.current && data) setBans(data as BannedUser[]);
    };
    load();

    const ch = supabase
      .channel(`bans-${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'banned_users',
        filter: `room_id=eq.${roomId}`,
      }, ({ new: row }) => {
        if (!isMountedRef.current) return;
        setBans(prev => [row as BannedUser, ...prev]);
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'banned_users',
        filter: `room_id=eq.${roomId}`,
      }, ({ old: row }) => {
        if (!isMountedRef.current) return;
        setBans(prev => prev.filter(b => b.id !== (row as { id: string }).id));
      })
      .subscribe();

    return () => {
      isMountedRef.current = false;
      ch.unsubscribe();
    };
  }, [roomId]);

  const unban = async (id: string) => {
    const { error } = await supabase.from('banned_users').delete().eq('id', id);
    if (error) {
      toast.error('خطا در رفع مسدودیت: ' + error.message);
      return;
    }
    // Realtime DELETE handler will update state; no local mutation needed
  };

  if (!bans.length) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-gray-500 gap-2" role="status">
        <ShieldOff className="w-6 h-6" aria-hidden="true" />
        <p className="text-xs">هیچ کاربری مسدود نشده</p>
      </div>
    );
  }

  return (
    <div role="list" aria-label="لیست کاربران مسدود شده" className="space-y-1">
      {bans.map(b => (
        <div key={b.id} role="listitem" className="flex items-center gap-2 p-2 bg-gray-800 rounded-xl">
          <div
            className="w-6 h-6 rounded-full bg-red-900/50 flex items-center justify-center text-[10px] font-bold text-red-300 flex-shrink-0"
            aria-hidden="true"
          >
            {(b.display_name[0] || '?').toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-200 truncate">{b.display_name}</p>
            <p className="text-[10px] text-gray-500 truncate">
              {moment(b.banned_at).format('jYYYY/jMM/jDD HH:mm')}
              {b.reason ? ` — ${b.reason}` : ''}
            </p>
          </div>
          <button
            onClick={() => unban(b.id)}
            aria-label={`رفع مسدودیت ${b.display_name}`}
            title="رفع مسدودیت"
            className="p-1 rounded-lg hover:bg-teal-900/40 text-gray-500 hover:text-teal-400 transition-colors flex-shrink-0"
          >
            <UserCheck className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
