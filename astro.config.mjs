import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
    output: 'server',
    adapter: cloudflare({
        routes: {
            extend: {
                include: ['/*'],
                exclude: [
                    '/_astro/*',
                    '/fonts/*',
                    '/images/*',
                    '/favicon.ico',
                    '/sitemap.xml',
                    '/robots.txt'
                ]
            }
        }
    }),
    integrations: [tailwind(), mdx()]
});