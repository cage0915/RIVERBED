import type { APIRoute } from 'astro';

import { reorderFolderAlbums } from '../lib/albums/manifest-files';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);

    let input: unknown;
    try {
        input = await request.json();
    } catch {
        return json({ error: 'Invalid JSON' }, 400);
    }
    if (!isRecord(input) || typeof input.folder !== 'string' || !Array.isArray(input.order) ||
        input.order.some((slug) => typeof slug !== 'string')) {
        return json({ error: 'Missing folder or order' }, 400);
    }

    try {
        const albums = await reorderFolderAlbums(process.cwd(), input.folder, input.order as string[]);
        return json({
            success: true,
            albums: albums.map(({ slug, manifest }) => ({ slug, order: manifest.order })),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/folder not found/i.test(message)) return json({ error: 'Album folder not found' }, 404);
        if (/Invalid|duplicate|complete|another folder/.test(message)) {
            return json({ error: 'Invalid or incomplete Album order' }, 400);
        }
        console.error('Unable to save Album order', error);
        return json({ error: 'Unable to save Album order' }, 500);
    }
};
// Registered only by the local development server.
