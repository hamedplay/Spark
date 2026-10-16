import { useEffect, useState } from 'react';
import { supabase } from './supabase';

const BUCKET = 'chat-attachments';
const SIGNED_URL_TTL_SECONDS = 300;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const missingPathCache = new Map<string, number>();

export function extractChatAttachmentPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^\/+/, '');

  try {
    const url = new URL(trimmed);
    const markers = [
      `/storage/v1/object/public/${BUCKET}/`,
      `/storage/v1/object/sign/${BUCKET}/`,
      `/storage/v1/object/authenticated/${BUCKET}/`,
    ];
    const marker = markers.find((candidate) => url.pathname.includes(candidate));
    if (!marker) return null;
    return decodeURIComponent(url.pathname.split(marker)[1] || '').replace(/^\/+/, '') || null;
  } catch {
    return null;
  }
}

async function attachmentExists(path: string): Promise<boolean | null> {
  const slash = path.lastIndexOf('/');
  const folder = slash >= 0 ? path.slice(0, slash) : '';
  const fileName = slash >= 0 ? path.slice(slash + 1) : path;
  if (!fileName) return false;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(folder, { search: fileName, limit: 100 });

  if (error) return null;
  return (data || []).some(item => item.name === fileName);
}

export async function getChatAttachmentUrl(value: string | null | undefined): Promise<string | null> {
  const path = extractChatAttachmentPath(value);
  if (!path) return null;

  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now() + 15_000) return cached.url;

  const missingUntil = missingPathCache.get(path);
  if (missingUntil && missingUntil > Date.now()) return null;

  const exists = await attachmentExists(path);
  if (exists === false) {
    missingPathCache.set(path, Date.now() + SIGNED_URL_TTL_SECONDS * 1000);
    return null;
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    missingPathCache.set(path, Date.now() + 60_000);
    return null;
  }

  missingPathCache.delete(path);
  signedUrlCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
  });
  return data.signedUrl;
}

export function useChatAttachmentUrl(value: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    void getChatAttachmentUrl(value).then((signedUrl) => {
      if (active) setUrl(signedUrl);
    });
    return () => {
      active = false;
    };
  }, [value]);

  return url;
}
