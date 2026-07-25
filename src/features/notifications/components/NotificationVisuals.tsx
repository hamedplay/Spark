import {
  Bell,
  MessageCircle,
  Calendar,
  ClipboardList,
  FileText,
  Video,
  Users,
  Star,
} from 'lucide-react';
import { useState } from 'react';

export function NotificationTypeIcon({
  type,
  size = 18,
}: {
  type: string;
  size?: number;
}) {
  const s = size;
  const cls = 'flex-shrink-0';

  if (type === 'chat')
    return (
      <MessageCircle
        size={s}
        className={`${cls} text-teal-500`}
      />
    );
  if (
    type === 'meeting' ||
    type === 'calendar'
  )
    return (
      <Calendar
        size={s}
        className={`${cls} text-blue-500`}
      />
    );
  if (type === 'task')
    return (
      <ClipboardList
        size={s}
        className={`${cls} text-amber-500`}
      />
    );
  if (type === 'note')
    return (
      <FileText
        size={s}
        className={`${cls} text-green-500`}
      />
    );
  if (
    type === 'video_conference' ||
    type === 'conference'
  )
    return (
      <Video
        size={s}
        className={`${cls} text-rose-500`}
      />
    );
  if (type === 'group')
    return (
      <Users
        size={s}
        className={`${cls} text-sky-500`}
      />
    );
  if (type === 'star')
    return (
      <Star
        size={s}
        className={`${cls} text-yellow-500`}
      />
    );

  return (
    <Bell
      size={s}
      className={`${cls} text-gray-400`}
    />
  );
}

export function NotificationAvatar({
  url,
  name,
  size = 32,
}: {
  url?: string | null;
  name?: string | null;
  size?: number;
}) {
  const [imageError, setImageError] =
    useState(false);
  const initials = (name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (url && !imageError) {
    return (
      <img
        src={url}
        alt={name || ''}
        className="rounded-full object-cover flex-shrink-0"
        style={{
          width: size,
          height: size,
        }}
        onError={() =>
          setImageError(true)
        }
      />
    );
  }

  return (
    <div
      className="rounded-full flex items-center justify-center bg-gradient-to-br from-teal-500 to-teal-700 text-white font-bold flex-shrink-0 text-xs"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
      }}
    >
      {initials}
    </div>
  );
}
