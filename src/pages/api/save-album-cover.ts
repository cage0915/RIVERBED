import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

import { applyAlbumCoverConfig } from '../../lib/album-frontmatter.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const finiteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
const safeKeySegment = (value: string) =>
    value.length > 0 && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !value.includes('\0');
const validCoverKey = (value: string) => {
    const parts = value.split('/');
    if (parts.length !== 1 && parts.length !== 3) return false;
    return parts.every(safeKeySegment) && /\.(?:jpe?g|png|webp|avif)$/i.test(parts.at(-1) || '');
};

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);

    let body: {
        albumSlug?: string;
        coverKey?: string;
        coverZoom?: number;
        coverOffset?: { x?: number; y?: number };
    };
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON' }, 400);
    }

    const albumSlug = body.albumSlug?.trim() || '';
    const coverKey = body.coverKey?.trim() || '';
    const coverZoom = body.coverZoom;
    const x = body.coverOffset?.x;
    const y = body.coverOffset?.y;

    if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(albumSlug)) return json({ error: 'Invalid album slug' }, 400);
    if (!validCoverKey(coverKey)) {
        return json({ error: 'Invalid cover key' }, 400);
    }
    if (!finiteInRange(coverZoom, 1, 4) || !finiteInRange(x, 0, 100) || !finiteInRange(y, 0, 100)) {
        return json({ error: 'Invalid cover position' }, 400);
    }

    const mdxPath = path.resolve(process.cwd(), 'src/content/albums', `${albumSlug}.mdx`);
    if (!fs.existsSync(mdxPath)) return json({ error: 'Page not found' }, 404);

    try {
        const original = fs.readFileSync(mdxPath, 'utf8');
        const updated = applyAlbumCoverConfig(original, {
            coverKey,
            coverZoom,
            coverOffset: { x, y },
        });
        fs.writeFileSync(mdxPath, updated, 'utf8');
        return json({ success: true });
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Unable to save cover' }, 500);
    }
};
