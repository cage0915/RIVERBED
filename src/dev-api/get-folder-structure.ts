import type { APIRoute } from 'astro';

import { createFolderStructure } from '../lib/albums/folder-structure';
import { readAllAlbumManifestFiles } from '../lib/albums/manifest-files';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

export const GET: APIRoute = async ({ url }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);

    const folder = url.searchParams.get('folder');
    if (!folder || !/^[a-z0-9-]+$/.test(folder)) {
        return json({ error: 'Missing folder parameter' }, 400);
    }
    try {
        const albums = createFolderStructure(
            await readAllAlbumManifestFiles(process.cwd()),
            folder,
        );
        if (albums.length === 0) return json({ error: 'Folder not found' }, 404);
        return json({ albums });
    } catch (error) {
        console.error('Unable to load Album folder', error);
        return json({ error: 'Unable to load Album folder' }, 500);
    }
};
// Registered only by the local development server.
