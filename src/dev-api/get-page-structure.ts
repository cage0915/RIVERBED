import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { readAlbumManifestFile } from '../lib/albums/manifest-files';
import { albumPageManagerMetadata, assertAlbumAssetStorageSafe } from '../lib/albums/album-lifecycle';
import { albumBlocksToPageBlocks } from '../lib/page-structure';
import { json } from './_http';

export const GET: APIRoute = async ({ request }) => {
    const url = new URL(request.url);
    const albumSlug = url.searchParams.get('albumSlug');

    if (!albumSlug || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(albumSlug)) {
        return json({ error: 'Missing albumSlug' }, 400);
    }

    let manifest;
    try {
        manifest = await readAlbumManifestFile(process.cwd(), albumSlug);
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Manifest not found' }, 404);
    }
    const blocks = albumBlocksToPageBlocks(manifest.blocks);

    const localDirectory = path.resolve(process.cwd(), 'r2', albumSlug);
    await assertAlbumAssetStorageSafe(process.cwd(), albumSlug);
    const localPhotos = fs.existsSync(localDirectory)
        ? fs.readdirSync(localDirectory, { withFileTypes: true })
            .filter((entry) => entry.isFile() && /\.(?:jpe?g|png|webp|avif)$/i.test(entry.name))
            .map((entry) => {
                const stat = fs.statSync(path.join(localDirectory, entry.name));
                return { name: entry.name, size: stat.size, modified: stat.mtime.toISOString() };
            })
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
        : [];

    return json({
        metadata: albumPageManagerMetadata(albumSlug, manifest),
        blocks,
        localPhotos,
    });
};
// Registered only by the local development server.
