import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';
import devApiRoutes from './src/integrations/dev-api-routes.mjs';

// https://astro.build/config
export default defineConfig({
    site: 'https://riverbed.cage0915.com',
    output: 'static',
    integrations: [tailwind(), mdx(), devApiRoutes()],
    vite: {
        plugins: [
            {
                name: 'serve-root-r2',
                configureServer(server) {
                    server.middlewares.use('/r2', (req, res, next) => {
                        const baseDir = path.resolve(process.cwd(), 'r2');
                        const filePath = path.join(baseDir, req.url.split('?')[0]);
                        
                        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                            const ext = path.extname(filePath).toLowerCase();
                            const mimes = {
                                '.jpg': 'image/jpeg',
                                '.jpeg': 'image/jpeg',
                                '.png': 'image/png',
                                '.webp': 'image/webp',
                                '.avif': 'image/avif'
                            };
                            res.setHeader('Content-Type', mimes[ext] || 'application/octet-stream');
                            res.end(fs.readFileSync(filePath));
                        } else {
                            next();
                        }
                    });
                }
            }
        ]
    }
});
