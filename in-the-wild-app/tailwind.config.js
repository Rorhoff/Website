/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        wild: {
          bg: '#0c0a09',
          surface: '#1c1917',
          border: '#292524',
          accent: '#10b981',
          amber: '#f59e0b',
        },
      },
    },
  },
  plugins: [],
};
