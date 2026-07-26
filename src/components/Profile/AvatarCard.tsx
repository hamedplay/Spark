import { Camera, Loader as Loader2 } from 'lucide-react';
import type { Profile } from './types';

export function AvatarCard({ profile, uploading, avatarProcessing, onAvatarUpload }: { profile: Profile; uploading: boolean; avatarProcessing: boolean; onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  const initials = profile.full_name
    ? profile.full_name.split(' ').map(w => w[0]).slice(0, 2).join('')
    : profile.email[0]?.toUpperCase() || '?';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-4">
      <div className="flex items-center gap-6">
        <div className="relative flex-shrink-0">
          <div className="w-24 h-24 rounded-2xl overflow-hidden bg-teal-100 dark:bg-teal-900/30">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-2xl font-bold text-teal-600 dark:text-teal-400">{initials}</span>
              </div>
            )}
          </div>
          <label className={`absolute -bottom-2 -left-2 w-8 h-8 bg-teal-500 hover:bg-teal-600 rounded-xl flex items-center justify-center cursor-pointer shadow-md transition ${(uploading || avatarProcessing) ? 'opacity-60 pointer-events-none' : ''}`}>
            {(uploading || avatarProcessing) ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatarUpload} className="hidden" disabled={uploading || avatarProcessing} />
          </label>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {profile.full_name || 'نام تعریف نشده'}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{profile.email}</p>
          {avatarProcessing && (
            <p className="text-xs text-teal-600 dark:text-teal-400 mt-1 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              در حال پردازش تصویر...
            </p>
          )}
          {profile.position && profile.organization && (
            <p className="text-sm text-teal-600 dark:text-teal-400 mt-1">
              {profile.position} — {profile.organization}
            </p>
          )}
          {profile.updated_at && (
            <p className="text-xs text-gray-400 mt-1">
              آخرین به‌روزرسانی: {new Date(profile.updated_at).toLocaleString('fa-IR')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
