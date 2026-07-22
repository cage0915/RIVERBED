import type { APIRoute } from 'astro';
import {
    readAlbumManifestFile,
    updatePhotoTags,
} from '../lib/albums/manifest-files';
import {
    findMountainRegion,
    isMountainRegion,
    readMountainRegion,
    writeMountainRegion,
} from '../lib/mountain-files';
import type { MountainRegion } from '../lib/mountains';

export const POST: APIRoute = async ({ request }) => {
    // Only allow in dev mode
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let body: { action?: 'update' | 'delete'; sourceAlbumSlug?: string; filename?: string; tagName?: string; x?: number; y?: number; region?: MountainRegion };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { action, sourceAlbumSlug, filename, tagName, x, y } = body;

    if ((action !== 'update' && action !== 'delete') || !sourceAlbumSlug || !filename || !tagName || x == null || y == null) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const cwd = process.cwd();
    let currentTags: { name: string; x: number; y: number }[];
    try {
        const manifest = await readAlbumManifestFile(cwd, sourceAlbumSlug);
        const photo = manifest.photos.find((entry) => entry.filename === filename);
        if (!photo) {
            return new Response(JSON.stringify({ error: 'Photo not found' }), { status: 404, headers: { 'Content-Type': 'application/json' }});
        }
        currentTags = photo.tags;
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to read Album manifest' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
    }
    const existingMountain =
        action === 'update' ? await findMountainRegion(tagName) : undefined;
    if (action === 'update' && !existingMountain && !isMountainRegion(body.region)) {
        return new Response(
            JSON.stringify({ error: 'Choose a region for the new mountain' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
    }

    if (action === 'delete') {
        currentTags = currentTags.filter(t =>
            !(t.name === tagName && Math.abs(t.x - x) < 0.1 && Math.abs(t.y - y) < 0.1)
        );
    } else {
        currentTags = [
            ...currentTags,
            { name: tagName, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 },
        ];
    }

    try {
        await updatePhotoTags(cwd, sourceAlbumSlug, filename, currentTags);
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to save photo tags' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
    }

    if (action === 'update' && !existingMountain) {
        if (!isMountainRegion(body.region)) throw new Error('Missing mountain region');
        const mountains = await readMountainRegion(body.region);
        mountains.push({ name: tagName, elevation: null, description: '' });
        await writeMountainRegion(body.region, mountains);
    }

    return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
};
// Registered only by the local development server.
