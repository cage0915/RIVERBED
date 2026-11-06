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
} from '../lib/mountains/files';
import type { MountainRegion } from '../lib/mountains/catalog';
import { json } from './_http';

export const POST: APIRoute = async ({ request }) => {
    // Only allow in dev mode
    let body: { action?: 'update' | 'delete'; sourceAlbumSlug?: string; filename?: string; tagName?: string; x?: number; y?: number; region?: MountainRegion };
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const { action, sourceAlbumSlug, filename, tagName, x, y } = body;

    if ((action !== 'update' && action !== 'delete') || !sourceAlbumSlug || !filename || !tagName || x == null || y == null) {
        return json({ error: 'Missing required fields' }, 400);
    }

    const cwd = process.cwd();
    let currentTags: { name: string; x: number; y: number }[];
    try {
        const manifest = await readAlbumManifestFile(cwd, sourceAlbumSlug);
        const photo = manifest.photos.find((entry) => entry.filename === filename);
        if (!photo) {
            return json({ error: 'Photo not found' }, 404);
        }
        currentTags = photo.tags;
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Unable to read Album manifest' }, 400);
    }
    const existingMountain =
        action === 'update' ? await findMountainRegion(tagName) : undefined;
    if (action === 'update' && !existingMountain && !isMountainRegion(body.region)) {
        return json({ error: 'Choose a region for the new mountain' }, 400);
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
        return json({ error: error instanceof Error ? error.message : 'Unable to save photo tags' }, 400);
    }

    if (action === 'update' && !existingMountain) {
        if (!isMountainRegion(body.region)) throw new Error('Missing mountain region');
        const mountains = await readMountainRegion(body.region);
        mountains.push({ name: tagName, elevation: null, description: '' });
        await writeMountainRegion(body.region, mountains);
    }

    return json({ success: true });
};
// Registered only by the local development server.
