import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Use Node.js adapter for production deployment
		adapter: adapter({
			// Output to build directory
			out: 'build',
			// Precompress files for better performance
			precompress: true,
			// Environment variables prefix
			envPrefix: 'SIVACOR_'
		}),
		// Configure for production hosting
		serviceWorker: {
			register: false
		}
	}
};

export default config;
