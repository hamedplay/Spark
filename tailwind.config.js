/** @type {import('tailwindcss').Config} */

const accentScale = {
  50: 'rgb(var(--spark-accent-50, 238 242 255) / <alpha-value>)',
  100: 'rgb(var(--spark-accent-100, 224 231 255) / <alpha-value>)',
  200: 'rgb(var(--spark-accent-200, 199 210 254) / <alpha-value>)',
  300: 'rgb(var(--spark-accent-300, 165 180 252) / <alpha-value>)',
  400: 'rgb(var(--spark-accent-400, 129 140 248) / <alpha-value>)',
  500: 'rgb(var(--spark-accent-500, 99 102 241) / <alpha-value>)',
  600: 'rgb(var(--spark-accent-600, 79 70 229) / <alpha-value>)',
  700: 'rgb(var(--spark-accent-700, 67 56 202) / <alpha-value>)',
  800: 'rgb(var(--spark-accent-800, 55 48 163) / <alpha-value>)',
  900: 'rgb(var(--spark-accent-900, 49 46 129) / <alpha-value>)',
  950: 'rgb(var(--spark-accent-950, 30 27 75) / <alpha-value>)',
};

export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Neutral application surfaces. Replacing Tailwind's blue-tinted slate
        // with a zinc/graphite scale keeps light and dark modes visibly neutral.
        slate: {
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },

        // Runtime corporate primary. Existing indigo/violet/teal utilities all
        // consume appearance.primary_color, so legacy and modern screens react
        // to one global accent without rewriting every component.
        indigo: accentScale,
        violet: accentScale,
        teal: accentScale,

        // Informational actions use a steel/graphite family instead of bright
        // blue, keeping them distinct from the global primary and success.
        blue: {
          50: '#f7f8f8',
          100: '#eceff0',
          200: '#d6dde0',
          300: '#b3c0c5',
          400: '#8b9da4',
          500: '#6e8188',
          600: '#586970',
          700: '#49565c',
          800: '#3f494d',
          900: '#373f42',
          950: '#1d2325',
        },

        // Search/navigation accents remain slightly brighter than primary while
        // staying within the same corporate green family.
        cyan: {
          50: '#effcf9',
          100: '#d7f6ee',
          200: '#b2eadc',
          300: '#7bd5c2',
          400: '#43b9a5',
          500: '#279b89',
          600: '#1e7d70',
          700: '#1d655c',
          800: '#1c514b',
          900: '#1b443f',
          950: '#0a2825',
        },
      },
    },
  },
  plugins: [],
};
