import type { APIRoute } from 'astro';

import { normalizeAssetKey, validateAlbumSlug } from '../lib/albums/keys';
import {
    AlbumManifestMutationError,
    updateAlbumCover,
} from '../lib/albums/manifest-files';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const finiteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
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
    if (!isRecord(input) || !isRecord(input.coverOffset)) {
        return json({ error: 'Invalid cover request' }, 400);
    }

    const albumSlug = typeof input.albumSlug === 'string' ? input.albumSlug.trim() : '';
    const coverKey = typeof input.coverKey === 'string' ? input.coverKey.trim() : '';
    const coverZoom = input.coverZoom;
    const x = input.coverOffset.x;
    const y = input.coverOffset.y;
    if (!finiteInRange(coverZoom, 1, 4) || !finiteInRange(x, 0, 100) || !finiteInRange(y, 0, 100)) {
        return json({ error: 'Invalid cover position' }, 400);
    }

    let resolvedCoverKey: string;
    let validatedAlbumSlug: string;
    try {
        validatedAlbumSlug = validateAlbumSlug(albumSlug);
        resolvedCoverKey = normalizeAssetKey(coverKey);
    } catch (error) {
        if (error instanceof Error && /Invalid (?:asset key|album slug)/.test(error.message)) {
            return json({ error: 'Invalid Album or cover key' }, 400);
        }
        console.error('Unable to validate Album cover request', error);
        return json({ error: 'Unable to validate Album cover request' }, 500);
    }

    try {
        const manifest = await updateAlbumCover(process.cwd(), validatedAlbumSlug, {
            assetKey: resolvedCoverKey,
            zoom: coverZoom,
            offset: { x, y },
        });
        const storedCoverKey = manifest.cover.photo.kind === 'local'
            ? `${validatedAlbumSlug}/${manifest.cover.photo.filename}`
            : manifest.cover.photo.assetKey;
        return json({
            success: true,
            coverKey: storedCoverKey,
            coverZoom: manifest.cover.zoom,
            coverOffset: manifest.cover.offset,
        });
    } catch (error) {
        if (error instanceof AlbumManifestMutationError) {
            if (error.code === 'album-not-found') return json({ error: 'Album not found' }, 404);
            return json({ error: 'Cover photo is not tracked by an Album' }, 400);
        }
        console.error('Unable to save Album cover', error);
        return json({ error: 'Unable to save Album cover' }, 500);
    }
};
// Registered only by the local development server.
