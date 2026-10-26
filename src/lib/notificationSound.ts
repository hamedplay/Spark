let context: AudioContext | undefined;

// Called directly by a click/key gesture to satisfy browser autoplay rules.
export function unlockNotificationSound(): void {
  try {
    const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;
    if (!context || context.state === 'closed') context = new Constructor();
    if (context.state === 'suspended') void context.resume().catch(() => {});
  } catch { /* Notifications remain available without audio support. */ }
}

export function playNotificationSound(): void {
  if (!context || context.state !== 'running') return;
  try {
    const start = context.currentTime;
    for (const [offset, frequency] of [[0, 660], [0.14, 880]]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start + offset);
      gain.gain.linearRampToValueAtTime(0.12, start + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + offset + 0.16);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(start + offset); oscillator.stop(start + offset + 0.18);
    }
  } catch { /* Muted/blocked audio must not interrupt notification delivery. */ }
}
