import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/in-the-wild/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
