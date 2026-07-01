import { useEffect, useRef, useState } from 'react';
import { ShieldOff, UserCheck, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import moment from 'moment-jalaali';
import toast from 'react-hot-toast';

interface BannedUser {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  banned_at: string;
  expires_at: string | null;
  reason: string | null;
}

interface Props {
  roomId: string;
}

function isActive(ban: BannedUser, now: number): boolean {
  if (!ban.expires_at) return true;
  return new Date(ban.expires_at).getTime() > now;
}

function expiryLabel(ban: BannedUser, now: number): string {
  if (!ban.expires_at) return 'دائمی';
  const diff = Math.round((new Date(ban.expires_at).getTime() - now) / 60000);
  if (diff <= 0) return 'منقضی';
  if (diff < 60) return `${diff} دقیقه مانده`;
  return `${Math.round(diff / 60)} ساعت مانده`;
}

export function BanList({ roomId }: Props) {
  const [bans, setBans] = useState<BannedUser[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const isMountedRef = useRef(true);

  // Tick every 30s to refresh countdown labels
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    const load = async () => {
      const { data } = await supabase
        .from('banned_users')
        .select('id, room_id, user_id, display_name, banned_at, expires_at, reason')
        .eq('room_id', roomId)
        .order('banned_at', { ascending: false });
      if (isMountedRef.current && data) setBans(data as BannedUser[]);
    };
    load();

    // Listen to ALL events — upsert on existing rows fires UPDATE, not INSERT
    const ch = supabase
      .channel(`bans-${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banned_users', filter: `room_id=eq.${roomId}` },
        ({ eventType, new: newRow, old: oldRow }) => {
          if (!isMountedRef.current) return;

          if (eventType === 'INSERT') {
            setBans(prev => {
              // Avoid duplicates (belt-and-suspenders)
              if (prev.some(b => b.id === (newRow as BannedUser).id)) return prev;
              return [newRow as BannedUser, ...prev];
            });
          } else if (eventType === 'UPDATE') {
            setBans(prev =>
              prev.map(b => b.id === (newRow as BannedUser).id ? newRow as BannedUser : b)
            );
          } else if (eventType === 'DELETE') {
            setBans(prev => prev.filter(b => b.id !== (oldRow as { id: string }).id));
          }
        }
      )
      .subscribe();

    return () => {
      isMountedRef.current = false;
      ch.unsubscribe();
    };
  }, [roomId]);

  const unban = async (id: string) => {
    const { error } = await supabase.from('banned_users').delete().eq('id', id);
    if (error) toast.error('خطا در رفع مسدودیت: ' + error.message);
  };

  const activeBans = bans.filter(b => isActive(b, now));

  if (!activeBans.length) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-gray-500 gap-2" role="status">
        <ShieldOff className="w-6 h-6" aria-hidden="true" />
        <p className="text-xs">هیچ کاربری مسدود نشده</p>
      </div>
    );
  }

  return (
    <div role="list" aria-label="لیست کاربران مسدود شده" className="space-y-1">
      {activeBans.map(b => (
        <div key={b.id} role="listitem" className="flex items-start gap-2 p-2 bg-gray-800 rounded-xl">
          <div
            className="w-6 h-6 rounded-full bg-red-900/50 flex items-center justify-center text-[10px] font-bold text-red-300 flex-shrink-0 mt-0.5"
            aria-hidden="true"
          >
            {(b.display_name[0] || '?').toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-200 truncate">{b.display_name}</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <p className="text-[10px] text-gray-500">
                {moment(b.banned_at).format('jYYYY/jMM/jDD HH:mm')}
              </p>
              <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${b.expires_at ? 'bg-amber-900/30 text-amber-400' : 'bg-red-900/30 text-red-400'}`}>
                <Clock className="w-2.5 h-2.5" />
                {expiryLabel(b, now)}
              </span>
            </div>
            {b.reason && (
              <p className="text-[10px] text-gray-400 mt-0.5 truncate" title={b.reason}>
                {b.reason}
              </p>
            )}
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
