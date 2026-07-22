import type { APIRoute } from 'astro';

import { createCoverPickerInventory } from '../lib/albums/cover-picker';
import { readAllAlbumManifestFiles } from '../lib/albums/manifest-files';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

export const GET: APIRoute = async ({ url }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);
    const requestedSlug = url.searchParams.get('albumSlug') || '';
    if (requestedSlug && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(requestedSlug)) {
        return json({ error: 'Invalid Album slug' }, 400);
    }
    try {
        return json(createCoverPickerInventory(
            await readAllAlbumManifestFiles(process.cwd()),
            requestedSlug,
        ));
    } catch (error) {
        console.error('Unable to load cover picker inventory', error);
        return json({ error: 'Unable to load cover picker inventory' }, 500);
    }
};
// Registered only by the local development server.
