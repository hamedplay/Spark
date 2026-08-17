export type RoleType = 'host' | 'admin' | 'moderator' | 'member' | 'guest';
export type Permission =
  | 'kick' | 'ban' | 'transfer_host'
  | 'toggle_chat' | 'toggle_whiteboard'
  | 'mute_all' | 'mute_user'
  | 'manage_polls' | 'lower_hand' | 'manage_roles';

export const ROLE_PERMISSIONS: Record<RoleType, Set<Permission>> = {
  host:      new Set(['kick','ban','transfer_host','toggle_chat','toggle_whiteboard','mute_all','mute_user','manage_polls','lower_hand','manage_roles']),
  admin:     new Set(['kick','ban','toggle_chat','toggle_whiteboard','mute_all','mute_user','manage_polls','lower_hand','manage_roles']),
  moderator: new Set(['mute_user','manage_polls','lower_hand','manage_roles']),
  member:    new Set(),
  guest:     new Set(),
};

export const ROLE_LABELS: Record<RoleType, string> = { host: 'میزبان', admin: 'مدیر', moderator: 'ناظر', member: 'عضو', guest: 'مهمان' };
export const ROLE_COLORS: Record<RoleType, string> = {
  host: 'text-amber-400 bg-amber-900/30',
  admin: 'text-blue-400 bg-blue-900/30',
  moderator: 'text-purple-400 bg-purple-900/30',
  member: 'text-gray-400 bg-gray-700/50',
  guest: 'text-gray-500 bg-gray-800/50',
};
