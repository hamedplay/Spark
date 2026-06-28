import React, { useEffect, useState } from 'react';
import { ShieldOff, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface BannedUser {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  reason: string | null;
  banned_at: string;
}

interface Props {
  roomId: string;
}

export function BanList({ roomId }: Props) {
  const [bans, setBans] = useState<BannedUser[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('banned_users')
        .select('*')
        .eq('room_id', roomId)
        .order('banned_at', { ascending: false });
      if (data) setBans(data);
    };
    load();

    const ch = supabase
      .channel(`bans-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'banned_users', filter: `room_id=eq.${roomId}` }, load)
      .subscribe();

    return () => { ch.unsubscribe(); };
  }, [roomId]);

  const unban = async (id: string) => {
    await supabase.from('banned_users').delete().eq('id', id);
    setBans(prev => prev.filter(b => b.id !== id));
  };

  if (!bans.length) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-gray-500 gap-2">
        <ShieldOff className="w-6 h-6" />
        <p className="text-xs">هیچ کاربری مسدود نشده</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {bans.map(b => (
        <div key={b.id} className="flex items-center gap-2 p-2 bg-gray-800 rounded-xl">
          <div className="w-6 h-6 rounded-full bg-red-900/50 flex items-center justify-center text-[10px] font-bold text-red-300 flex-shrink-0">
            {b.display_name[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-200 truncate">{b.display_name}</p>
            {b.reason && <p className="text-xs text-gray-500 truncate">{b.reason}</p>}
          </div>
          <button
            onClick={() => unban(b.id)}
            title="رفع مسدودیت"
            className="p-1 rounded-lg hover:bg-red-900/40 text-gray-500 hover:text-red-400 transition-colors flex-shrink-0"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
