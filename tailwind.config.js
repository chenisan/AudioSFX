/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        soul: {
          red: '#E94560',
          bg: '#0d0d0d',
          panel: '#1a1a1a',
          track: '#252525',
          border: '#333333',
        },
      },
      fontFamily: {
        ui: ['Inter', 'Noto Sans TC', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
