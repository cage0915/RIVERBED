import type { APIRoute } from 'astro';
import {
    allMountains as mountains,
    MOUNTAIN_REGION_DEFINITIONS as regions,
} from '../lib/mountains';
import { readAllAlbumManifestFiles } from '../lib/albums/manifest-files';


export const GET: APIRoute = async () => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const manifests = await readAllAlbumManifestFiles(process.cwd());
    const allTags = Object.fromEntries(
        Object.entries(manifests).map(([slug, manifest]) => [
            slug,
            Object.fromEntries(
                manifest.photos
                    .filter((photo) => photo.tags.length > 0)
                    .map((photo) => [photo.filename, photo.tags]),
            ),
        ]),
    );

    return new Response(
        JSON.stringify({ mountains, regions, allTags }),
        {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }
    );
};
// Registered only by the local development server.
