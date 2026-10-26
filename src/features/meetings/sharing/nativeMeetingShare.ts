export type MeetingShareResult = 'shared' | 'copied' | 'unsupported' | 'cancelled';

function cancelled(error: unknown): boolean {
  return error instanceof Object && 'name' in error && error.name === 'AbortError';
}

// Call from the user's click handler, before any asynchronous preparation.
export async function shareMeetingText(title: string, text: string): Promise<MeetingShareResult> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (error) {
      if (cancelled(error)) return 'cancelled';
    }
  }
  if (!navigator.clipboard?.writeText) return 'unsupported';
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'unsupported';
  }
}

export async function shareMeetingImage(title: string, file: File): Promise<MeetingShareResult> {
  if (!navigator.share) return 'unsupported';
  try {
    // Older implementations expose share() without canShare(). Let share()
    // validate the file in that case instead of rejecting a supported device.
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return 'unsupported';
    await navigator.share({ title, files: [file] });
    return 'shared';
  } catch (error) {
    return cancelled(error) ? 'cancelled' : 'unsupported';
  }
}
