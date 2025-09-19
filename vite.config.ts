import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      'react-native-document-picker': path.resolve(__dirname, 'src/shims/document-picker.web.ts'),
      'react-native-fs': path.resolve(__dirname, 'src/shims/empty.web.ts'),
      'react-native-blob-util': path.resolve(__dirname, 'src/shims/empty.web.ts'),
      '@react-native-clipboard/clipboard': path.resolve(__dirname, 'src/shims/clipboard.web.ts'),
    },
  },
  define: {
    global: 'window',
  },
  server: {
    port: 5173,
  },
});
