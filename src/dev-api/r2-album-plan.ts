import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { loadR2SourceIndex } from '../lib/r2-source-files';
import { getR2AdminClient } from '../lib/r2-admin-client';
import { readAlbumManifestFile } from '../lib/albums/manifest-files';
import { assertAlbumAssetStorageSafe } from '../lib/albums/album-lifecycle';

const IMAGE_PATTERN = /\.(?:jpe?g|png|webp|avif)$/i;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

export const GET: APIRoute = async ({ url }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);
    const albumSlug = (url.searchParams.get('albumSlug') || '').replace(/^\/+|\/+$/g, '');
    if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(albumSlug)) return json({ error: 'Invalid albumSlug' }, 400);

    const projectRoot = process.cwd();
    const prefix = `${albumSlug}/`;
    let manifest;
    try {
        manifest = await readAlbumManifestFile(projectRoot, albumSlug);
    } catch (error) {
        if ((error as Error & { cause?: NodeJS.ErrnoException }).cause?.code === 'ENOENT') {
            return json({ error: 'Page does not exist' }, 404);
        }
        throw error;
    }
    const required = [...new Set([
        ...manifest.photos.map(({ filename }) => `${prefix}${filename}`),
        ...(manifest.cover.photo.kind === 'local' ? [`${prefix}${manifest.cover.photo.filename}`] : []),
    ])];
    const globalIndex = loadR2SourceIndex(projectRoot);
    const localDir = path.resolve(projectRoot, 'r2', albumSlug);
    await assertAlbumAssetStorageSafe(projectRoot, albumSlug);
    const local = fs.existsSync(localDir)
        ? fs.readdirSync(localDir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && IMAGE_PATTERN.test(entry.name))
            .map((entry) => {
                const stat = fs.statSync(path.join(localDir, entry.name));
                const bytes = fs.readFileSync(path.join(localDir, entry.name));
                return {
                    key: `${prefix}${entry.name}`,
                    name: entry.name,
                    size: stat.size,
                    modified: stat.mtime.toISOString(),
                    sha256: createHash('sha256').update(bytes).digest('hex'),
                };
            })
        : [];
    const localMap = new Map(local.map((entry) => [entry.key, entry]));

    const r2 = await getR2AdminClient();
    if (!r2) {
        return json({
            albumSlug,
            prefix,
            remoteAvailable: false,
            required: required.map((key) => ({ key, local: localMap.get(key) || null, references: globalIndex.get(key) || [] })),
            localCandidates: local.filter((entry) => !required.includes(entry.key)),
            message: 'Remote R2 is unavailable. Configure the R2 credentials in .env and restart the development server.',
        });
    }

    try {
        const remote = (await r2.list(prefix)).filter((object) => IMAGE_PATTERN.test(object.key)).map((object) => ({
                key: object.key,
                size: object.size,
                etag: object.etag,
                uploaded: object.uploaded.toISOString(),
                sha256: object.customMetadata?.sha256,
            }));

        await Promise.all(remote.filter((entry) => localMap.has(entry.key) && !entry.sha256).map(async (entry) => {
            const object = await r2.head(entry.key);
            entry.sha256 = object?.customMetadata?.sha256;
        }));

        const remoteMap = new Map(remote.map((entry) => [entry.key, entry]));
        const requiredPlan = required.map((key) => {
            const localEntry = localMap.get(key) || null;
            const remoteEntry = remoteMap.get(key) || null;
            let action = 'none';
            if (!remoteEntry) action = localEntry ? 'upload' : 'missing';
            else if (localEntry && remoteEntry.sha256 && remoteEntry.sha256 !== localEntry.sha256) action = 'overwrite';
            else if (localEntry && !remoteEntry.sha256) action = 'unknown';
            return { key, local: localEntry, remote: remoteEntry, references: globalIndex.get(key) || [], action };
        });
        const remoteExtras = remote.filter((entry) => !required.includes(entry.key)).map((entry) => {
            const references = globalIndex.get(entry.key) || [];
            return {
                ...entry,
                references,
                action: references.length === 0 ? 'trash' : 'protected',
            };
        });

        return json({
            albumSlug,
            prefix,
            remoteAvailable: true,
            required: requiredPlan,
            remoteExtras,
            localCandidates: local.filter((entry) => !required.includes(entry.key)),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'R2 listing failed';
        return json({ error: message }, 502);
    }
};
// Registered only by the local development server.
