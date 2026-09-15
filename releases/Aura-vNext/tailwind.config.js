/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './ui/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './settings/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        aura: {
          50: '#f2f0ff',
          100: '#e6e2ff',
          200: '#cfc7ff',
          300: '#b0a1ff',
          400: '#8f74ff',
          500: '#6c47ff',
          600: '#5a2ef5',
          700: '#4b21d6',
          800: '#3e1daf',
          900: '#341b8c',
          950: '#1e0f5c',
        },
        surface: {
          0: '#07070b',
          1: '#0c0c13',
          2: '#12121c',
          3: '#191926',
        },
        glass: {
          light: 'rgba(255,255,255,0.045)',
          heavy: 'rgba(255,255,255,0.09)',
          border: 'rgba(255,255,255,0.09)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.25s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
        'pulse-soft': 'pulseSoft 1.8s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
    },
  },
  plugins: [],
}
