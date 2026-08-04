import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

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

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  accent: AccentKey;
  setAccent: (a: AccentKey) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function applyThemeToDom(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

function applyAccentToDom(accent: AccentKey) {
  const color = ACCENT_COLORS.find(c => c.key === accent);
  if (color) {
    document.documentElement.style.setProperty('--accent', color.hex);
  }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme') as Theme;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return saved || (prefersDark ? 'dark' : 'light');
  });

  const [accent, setAccentState] = useState<AccentKey>(() => {
    return (localStorage.getItem('accent_color') as AccentKey) || 'teal';
  });

  useEffect(() => { applyThemeToDom(theme); }, [theme]);
  useEffect(() => { applyAccentToDom(accent); }, [accent]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    localStorage.setItem('theme', next);
  };

  const toggleTheme = () => {
    setThemeState((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      return next;
    });
  };

  const setAccent = (a: AccentKey) => {
    setAccentState(a);
    localStorage.setItem('accent_color', a);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, accent, setAccent }}>
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
