import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5188, strictPort: true, host: true },
  build: { target: 'es2022' },
});
