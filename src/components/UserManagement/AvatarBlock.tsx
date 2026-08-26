import React from 'react';
import { Camera, Loader as Loader2 } from 'lucide-react';
import type { AdminProfile } from './types';

function AvatarBlock({ profile, editable, onUpload, uploading, avatarProcessing }: {
  profile: AdminProfile; editable: boolean;
  onUpload?: (file: File) => void; uploading?: boolean; avatarProcessing?: boolean;
}) {
  const initials = (profile.full_name || profile.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="relative flex-shrink-0">
      <div className="w-20 h-20 rounded-2xl overflow-hidden bg-teal-100 dark:bg-teal-900/30">
        {profile.avatar_url
          ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-teal-600 dark:text-teal-400">{initials}</div>}
      </div>
      {editable && onUpload && (
        <label className={`absolute -bottom-2 -left-2 w-7 h-7 bg-teal-500 hover:bg-teal-600 rounded-xl flex items-center justify-center cursor-pointer shadow-md transition${(uploading || avatarProcessing) ? ' opacity-60 pointer-events-none' : ''}`}>
          {(uploading || avatarProcessing) ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" /> : <Camera className="w-3.5 h-3.5 text-white" />}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading || avatarProcessing} onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
        </label>
      )}
    </div>
  );
}

export { AvatarBlock };
