import { defineConfig } from 'vite';

export default defineConfig({
  // Базовый путь для GitHub Pages (замените при необходимости)
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false
  }
});