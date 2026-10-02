export interface ChatThemeSettings {
  sentBubbleColor: string;
  receivedBubbleColor: string;
  backgroundStyle: 'dots' | 'lines' | 'plain' | 'gradient';
  backgroundGradientFrom: string;
  backgroundGradientTo: string;
  importantColor: string;
  urgentColor: string;
  confidentialColor: string;
  fontSize: 'sm' | 'md' | 'lg';
  bubbleRadius: 'rounded' | 'sharp' | 'pill';
}

export const DEFAULT_CHAT_THEME: ChatThemeSettings = {
  sentBubbleColor: '#e8f5ee',
  receivedBubbleColor: '#ffffff',
  backgroundStyle: 'dots',
  backgroundGradientFrom: '#f0fdf4',
  backgroundGradientTo: '#ecfdf5',
  importantColor: '#f59e0b',
  urgentColor: '#ef4444',
  confidentialColor: '#6b7280',
  fontSize: 'md',
  bubbleRadius: 'rounded',
};

const STORAGE_KEY = 'chat_theme_settings';

export function loadChatTheme(): ChatThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CHAT_THEME, ...JSON.parse(raw) };
  } catch {
    // Ignore malformed or unavailable local storage.
  }
  return { ...DEFAULT_CHAT_THEME };
}

export function saveChatTheme(settings: ChatThemeSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
