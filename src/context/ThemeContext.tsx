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
  toggleTheme: () => void;
  accent: AccentKey;
  setAccent: (a: AccentKey) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('theme') as Theme;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return savedTheme || (prefersDark ? 'dark' : 'light');
  });

  const [accent, setAccentState] = useState<AccentKey>(() => {
    return (localStorage.getItem('accent_color') as AccentKey) || 'teal';
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const color = ACCENT_COLORS.find(c => c.key === accent);
    if (color) {
      document.documentElement.style.setProperty('--accent', color.hex);
    }
  }, [accent]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const setAccent = (a: AccentKey) => {
    setAccentState(a);
    localStorage.setItem('accent_color', a);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, accent, setAccent }}>
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
