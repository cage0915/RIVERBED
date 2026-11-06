import type { APIRoute } from 'astro';

import { createFolderStructure } from '../lib/albums/folder-structure';
import { readAllAlbumManifestFiles } from '../lib/albums/manifest-files';
import { json } from './_http';

export const GET: APIRoute = async ({ url }) => {
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
