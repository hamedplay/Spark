import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, Loader as Loader2, Search, UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';

interface ContactRow {
  name: string;
  phone: string | null;
  company: string | null;
}

interface Props {
  meetingId: string;
  currentUserId: string;
  meetingSubject: string;
  meetingDate: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  names: string[];
  canManage: boolean;
  onChanged: (names: string[]) => void;
}

function cleanNames(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

export function ExternalInformeesManager({
  meetingId,
  currentUserId,
  meetingSubject,
  meetingDate,
  startTime,
  endTime,
  location,
  names,
  canManage,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [selected, setSelected] = useState<string[]>(cleanNames(names));
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(cleanNames(names));
  }, [names]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from('contacts_email')
      .select('name,phone,company')
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error('دریافت مخاطبین خارج سازمان ناموفق بود');
          setContacts([]);
        } else {
          setContacts((data || []) as ContactRow[]);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  const visibleContacts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fa-IR');
    if (!needle) return contacts;
    return contacts.filter(contact =>
      `${contact.name} ${contact.company || ''} ${contact.phone || ''}`
        .toLocaleLowerCase('fa-IR')
        .includes(needle),
    );
  }, [contacts, query]);

  const toggle = (name: string) => {
    setSelected(current => current.includes(name)
      ? current.filter(item => item !== name)
      : [...current, name]);
  };

  const sendInviteSms = async (addedNames: string[]) => {
    const mobiles = addedNames
      .map(name => contacts.find(contact => contact.name === name)?.phone?.trim() || '')
      .filter(phone => phone.length >= 7);
    if (!mobiles.length) return;

    const meetingTime = [startTime, endTime].filter(Boolean).join(' - ');
    const locationPart = location?.trim() ? ` در محل ${location.trim()}` : '';
    const fallbackMessage = `جهت اطلاع شما جلسه «${meetingSubject}»${meetingDate ? ` در تاریخ ${meetingDate}` : ''}${meetingTime ? ` ساعت ${meetingTime}` : ''}${locationPart} برگزار می‌شود.`;

    const { error } = await supabase.functions.invoke('send-sms', {
      body: {
        mode: 'external',
        mobiles,
        message: fallbackMessage,
        context: {
          meeting_subject: meetingSubject,
          meeting_date: meetingDate || '',
          meeting_time: meetingTime,
          start_time: startTime || '',
          end_time: endTime || '',
          location: location || '',
          location_part: locationPart,
        },
        meetingId,
        triggeredByUserId: currentUserId,
        category: 'meeting',
        eventType: 'informee_invite',
      },
    });

    if (error) throw error;
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const nextNames = cleanNames(selected);
    const previous = new Set(cleanNames(names));
    const addedNames = nextNames.filter(name => !previous.has(name));

    try {
      const { error } = await supabase
        .from('meetings')
        .update({ external_informees: nextNames } as never)
        .eq('id', meetingId);
      if (error) throw error;

      onChanged(nextNames);
      setOpen(false);
      toast.success('مطلعین خارج سازمان به‌روزرسانی شدند');

      if (addedNames.length > 0) {
        try {
          await sendInviteSms(addedNames);
        } catch {
          toast.error('اطلاعات ذخیره شد اما ارسال پیامک به برخی مطلعین خارج سازمان ناموفق بود');
        }
      }
    } catch (error) {
      console.error('external informees update failed', error);
      toast.error('ذخیره مطلعین خارج سازمان ناموفق بود');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {canManage && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
        >
          <UserPlus className="h-3.5 w-3.5" />
          مدیریت مطلعین خارج سازمان
        </button>
      )}

      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[420] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={() => setOpen(false)}>
          <div className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-amber-500" />
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">مطلعین خارج سازمان</h3>
                  <p className="mt-0.5 text-xs text-gray-400">این افراد شرکت‌کننده جلسه محسوب نمی‌شوند.</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="بستن">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-gray-100 p-4 dark:border-gray-800">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="جستجوی نام، شرکت یا شماره..."
                  className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-9 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-amber-900/30"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>
              ) : visibleContacts.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-400">مخاطبی یافت نشد</p>
              ) : (
                <div className="space-y-1">
                  {visibleContacts.map(contact => {
                    const checked = selected.includes(contact.name);
                    return (
                      <button
                        key={`${contact.name}:${contact.phone || ''}`}
                        type="button"
                        onClick={() => toggle(contact.name)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right transition hover:bg-gray-50 dark:hover:bg-gray-800/70"
                      >
                        <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${checked ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                          {checked && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{contact.name}</span>
                          <span className="block truncate text-xs text-gray-400">{[contact.company, contact.phone].filter(Boolean).join(' · ')}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-100 p-4 dark:border-gray-800">
              <span className="text-xs text-gray-400">{selected.length} مطلع انتخاب شده</span>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                ذخیره
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
