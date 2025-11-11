import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 4200,
  },
	plugins: [sveltekit()]
});
