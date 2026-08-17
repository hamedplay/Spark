import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';

export type Theme = 'light' | 'dark';

export const DEFAULT_ACCENT_COLOR = '#4f46e5';
const ACCENT_COLOR_CACHE_KEY = 'spark_primary_color';

export const ACCENT_COLORS = [
  { key: 'teal',    label: 'فیروزه‌ای',  hex: '#0d9488', tailwind: 'teal'    },
  { key: 'sky',     label: 'آسمانی',     hex: '#0ea5e9', tailwind: 'sky'     },
  { key: 'blue',    label: 'آبی',        hex: '#3b82f6', tailwind: 'blue'    },
  { key: 'emerald', label: 'زمردی',      hex: '#10b981', tailwind: 'emerald' },
  { key: 'slate',   label: 'سرمه‌ای',    hex: '#475569', tailwind: 'slate'   },
  { key: 'rose',    label: 'گلبهی',      hex: '#f43f5e', tailwind: 'rose'    },
  { key: 'amber',   label: 'کهربایی',    hex: '#f59e0b', tailwind: 'amber'   },
  { key: 'lime',    label: 'لیمویی',     hex: '#84cc16', tailwind: 'lime'    },
  { key: 'cyan',    label: 'سیانی',      hex: '#06b6d4', tailwind: 'cyan'    },
  { key: 'stone',   label: 'سنگی',       hex: '#78716c', tailwind: 'stone'   },
] as const;

export type AccentKey = typeof ACCENT_COLORS[number]['key'];

type Rgb = [number, number, number];

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** @deprecated Accent is globally controlled by appearance.primary_color. */
  accent: AccentKey;
  /** @deprecated Kept for backwards compatibility with legacy preference UIs. */
  setAccent: (a: AccentKey) => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortMatch) {
    return `#${shortMatch[1].split('').map(char => `${char}${char}`).join('')}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHexColor(hex) || DEFAULT_ACCENT_COLOR;
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function mixRgb(base: Rgb, target: Rgb, amount: number): Rgb {
  return base.map((channel, index) =>
    Math.round(channel + (target[index] - channel) * amount)
  ) as Rgb;
}

function toCssRgb(rgb: Rgb): string {
  return rgb.join(' ');
}

function buildAccentPalette(hex: string): Record<string, Rgb> {
  const base = hexToRgb(hex);
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];

  return {
    50: mixRgb(base, white, 0.95),
    100: mixRgb(base, white, 0.90),
    200: mixRgb(base, white, 0.78),
    300: mixRgb(base, white, 0.62),
    400: mixRgb(base, white, 0.38),
    500: mixRgb(base, white, 0.18),
    600: base,
    700: mixRgb(base, black, 0.16),
    800: mixRgb(base, black, 0.30),
    900: mixRgb(base, black, 0.43),
    950: mixRgb(base, black, 0.58),
  };
}

function applyThemeToDom(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

function applyAccentColorToDom(color: string) {
  if (typeof document === 'undefined') return;

  const normalized = normalizeHexColor(color) || DEFAULT_ACCENT_COLOR;
  const palette = buildAccentPalette(normalized);
  const root = document.documentElement;

  root.style.setProperty('--accent', normalized);
  root.style.setProperty('--spark-accent-rgb', toCssRgb(hexToRgb(normalized)));
  Object.entries(palette).forEach(([shade, rgb]) => {
    root.style.setProperty(`--spark-accent-${shade}`, toCssRgb(rgb));
  });
}

function readCachedAccentColor(): string {
  if (typeof window === 'undefined') return DEFAULT_ACCENT_COLOR;
  return normalizeHexColor(window.localStorage.getItem(ACCENT_COLOR_CACHE_KEY)) || DEFAULT_ACCENT_COLOR;
}

function readLegacyAccent(): AccentKey {
  if (typeof window === 'undefined') return 'teal';
  const saved = window.localStorage.getItem('accent_color');
  return ACCENT_COLORS.some(color => color.key === saved) ? (saved as AccentKey) : 'teal';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = window.localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // `accent` remains only as a compatibility surface for older preference code.
  // The visible application accent is `accentColor`, sourced from system_config.
  const [accent, setAccentState] = useState<AccentKey>(readLegacyAccent);
  const [accentColor, setAccentColorState] = useState<string>(readCachedAccentColor);

  useEffect(() => { applyThemeToDom(theme); }, [theme]);
  useEffect(() => { applyAccentColorToDom(accentColor); }, [accentColor]);

  // Load the global brand color as soon as ThemeProvider mounts. The appearance
  // row is intentionally readable before full authorization, so a fresh browser
  // receives the same branding on the login screen and after authentication.
  useEffect(() => {
    let cancelled = false;

    const hydrateGlobalAccent = async () => {
      const { data, error } = await supabase
        .from('system_config')
        .select('value')
        .eq('section', 'appearance')
        .eq('key', 'primary_color')
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error('[ThemeContext] failed to load global primary_color', error);
        return;
      }

      const normalized = normalizeHexColor(
        typeof data?.value === 'string' ? data.value : null
      );
      if (!normalized) return;

      setAccentColorState(normalized);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ACCENT_COLOR_CACHE_KEY, normalized);
      }
    };

    void hydrateGlobalAccent();
    return () => { cancelled = true; };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem('theme', next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      if (typeof window !== 'undefined') window.localStorage.setItem('theme', next);
      return next;
    });
  }, []);

  const setAccent = useCallback((next: AccentKey) => {
    setAccentState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem('accent_color', next);
  }, []);

  const setAccentColor = useCallback((next: string) => {
    const normalized = normalizeHexColor(next);
    if (!normalized) return;
    setAccentColorState(normalized);
    if (typeof window !== 'undefined') {
      // Cache only prevents a color flash before global config hydration.
      // The database value remains the source of truth and overwrites this cache.
      window.localStorage.setItem(ACCENT_COLOR_CACHE_KEY, normalized);
    }
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, accent, setAccent, accentColor, setAccentColor }),
    [theme, setTheme, toggleTheme, accent, setAccent, accentColor, setAccentColor]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
