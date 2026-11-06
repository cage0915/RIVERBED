import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sirv from 'sirv';
import devApiRoutes from './src/integrations/dev-api-routes.mjs';

// https://astro.build/config
export default defineConfig({
    site: 'https://riverbed.cage0915.com',
    output: 'static',
    integrations: [devApiRoutes()],
    vite: {
        plugins: [
            tailwindcss(),
            {
                // Serve local source photos from ./r2 during development.
                name: 'serve-root-r2',
                configureServer(server) {
                    server.middlewares.use('/r2', sirv('r2', { dev: true }));
                },
            },
        ],
    },
});
