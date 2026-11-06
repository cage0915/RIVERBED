import type { APIRoute } from 'astro';
import {
    allMountains as mountains,
    MOUNTAIN_REGION_DEFINITIONS as regions,
} from '../lib/mountains';
import { readAllAlbumManifestFiles } from '../lib/albums/manifest-files';
import { json } from './_http';

export const GET: APIRoute = async () => {
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

    return json({ mountains, regions, allTags });
};
// Registered only by the local development server.
