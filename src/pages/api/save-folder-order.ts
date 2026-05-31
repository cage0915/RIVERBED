import type { APIRoute } from 'astro';

import { applyAlbumCoverConfig } from '../../lib/album-frontmatter.js';

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
        });
    }

    const fs = await import('node:fs');
    const path = await import('node:path');

    let body: {
        folder: string;
        order: string[];
        albums?: Array<{
            slug: string;
            coverKey: string;
            coverZoom: number;
            coverOffset: { x: number; y: number };
        }>;
    };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
    }

    const { folder, order, albums = [] } = body;
    if (!folder || !Array.isArray(order)) {
        return new Response(JSON.stringify({ error: 'Missing folder or order' }), { status: 400 });
    }

    try {
        const targetDir = path.resolve(process.cwd(), 'src/content/albums', folder);
        if (!fs.existsSync(targetDir)) {
            return new Response(JSON.stringify({ error: 'Folder not found' }), { status: 404 });
        }

        const outputPath = path.join(targetDir, '_order.json');

        // Strip prefixes if they exist (e.g. yama/slug -> slug)
        const simplifiedOrder = order.map(item => item.includes('/') ? item.split('/')[1] : item);

        fs.writeFileSync(outputPath, JSON.stringify(simplifiedOrder, null, 4), 'utf8');

        for (const album of albums) {
            const mdxPath = path.resolve(process.cwd(), 'src/content/albums', `${album.slug}.mdx`);
            if (!fs.existsSync(mdxPath)) continue;

            const originalContent = fs.readFileSync(mdxPath, 'utf8');
            const nextContent = applyAlbumCoverConfig(originalContent, {
                coverKey: album.coverKey,
                coverZoom: album.coverZoom,
                coverOffset: album.coverOffset,
            });
            fs.writeFileSync(mdxPath, nextContent, 'utf8');
        }

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (err) {
        console.error(err);
        return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
    }
};
