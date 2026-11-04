export function normalizeRecipientName(value: string): string {
  return value.normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک')
    .replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[\u200c\u200d\s]+/g,' ').trim().toLocaleLowerCase('fa-IR');
}
export function matchingReminderUsers<T extends {user_id:string;full_name:string|null}>(users:T[],selected:string[],query:string):T[] {
  const terms=normalizeRecipientName(query).split(' ').filter(Boolean);
  return users.filter(user=>!selected.includes(user.user_id)&&terms.every(term=>normalizeRecipientName(user.full_name||'').includes(term)));
}
