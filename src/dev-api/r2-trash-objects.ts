import type { APIRoute } from 'astro';

import { getR2AdminClient } from '../lib/r2-admin-client';
import { loadR2SourceIndex } from '../lib/r2-source-files';
import { findExternalCoverConsumers, withR2SourceAlbumLocks } from '../lib/albums/album-lifecycle';
import { readAllAlbumManifestFiles } from '../lib/albums/manifest-files';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

type TrashRequest = { key?: string; etag?: string };

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);
    const r2 = await getR2AdminClient();
    if (!r2) return json({ error: 'Remote R2 is unavailable. Configure the R2 credentials in .env.' }, 503);

    try {
        const body = await request.json() as { objects?: TrashRequest[]; markers?: TrashRequest[] };
        const objects = Array.isArray(body.objects) ? body.objects : [];
        const markers = Array.isArray(body.markers) ? body.markers : [];
        if (objects.length + markers.length === 0 || objects.length + markers.length > 100) {
            return json({ error: 'Select between 1 and 100 objects or folder markers' }, 400);
        }

        const seen = new Set<string>();
        const requested = objects.map((entry) => ({
            key: String(entry.key || '').replace(/^\/+/, ''),
            etag: String(entry.etag || ''),
        }));
        for (const entry of requested) {
            if (!entry.key || entry.key.endsWith('/') || entry.key.startsWith('_trash/') || seen.has(entry.key)) {
                return json({ error: `Invalid Trash object: ${entry.key || '(empty)'}` }, 400);
            }
            if (!entry.etag) return json({ error: `Missing dry-run ETag for ${entry.key}` }, 400);
            if (!/^[a-z0-9-]+\/[a-z0-9-]+\/[^/]+\.(?:jpe?g|png|webp|avif)$/i.test(entry.key)) {
                return json({ error: `Invalid Trash object: ${entry.key}` }, 400);
            }
            seen.add(entry.key);
        }
        const requestedMarkers = markers.map((entry) => ({
            key: String(entry.key || '').replace(/^\/+/, ''),
            etag: String(entry.etag || ''),
        }));
        for (const entry of requestedMarkers) {
            if (!entry.key.endsWith('/') || entry.key.startsWith('_trash/') || seen.has(entry.key)) {
                return json({ error: `Invalid folder marker: ${entry.key || '(empty)'}` }, 400);
            }
            if (!entry.etag) return json({ error: `Missing dry-run ETag for ${entry.key}` }, 400);
            seen.add(entry.key);
        }

        return await withR2SourceAlbumLocks(process.cwd(), requested.map(({ key }) => key), async () => {
            const sourceIndex = loadR2SourceIndex();
            const manifests = await readAllAlbumManifestFiles(process.cwd());
            for (const entry of requested) {
                const consumers = findExternalCoverConsumers(manifests, entry.key);
                if (consumers.length > 0) {
                    return json({
                        error: `${entry.key} is used as an external cover by: ${consumers.join(', ')}`,
                        consumers,
                    }, 409);
                }
                const references = sourceIndex.get(entry.key) || [];
                if (references.length) return json({ error: `${entry.key} is now referenced by source`, references }, 409);
            }

            const date = new Date().toISOString().slice(0, 10);
            const objectsByKey = new Map<string, NonNullable<Awaited<ReturnType<typeof r2.get>>>>();
            for (const entry of requested) {
                const object = await r2.get(entry.key);
                if (!object) continue;
                if (object.etag !== entry.etag) {
                    return json({ error: `${entry.key} changed after the audit; refresh and try again` }, 409);
                }
                const trashKey = `_trash/${date}/${entry.key}`;
                if (await r2.head(trashKey)) {
                    return json({ error: `Trash already contains ${trashKey}; source was not removed` }, 409);
                }
                objectsByKey.set(entry.key, object);
            }
            const markersByKey = new Map<string, NonNullable<Awaited<ReturnType<typeof r2.head>>>>();
            for (const entry of requestedMarkers) {
                const marker = await r2.head(entry.key);
                if (!marker) continue;
                if (marker.etag !== entry.etag) {
                    return json({ error: `${entry.key} changed after the audit; refresh and try again` }, 409);
                }
                if (marker.size !== 0) {
                    return json({ error: `${entry.key} is not an empty folder marker and was not deleted` }, 409);
                }
                markersByKey.set(entry.key, marker);
            }
            const results: Array<{ key: string; action: 'trash' | 'delete-marker'; trashKey?: string; status: string }> = [];
            for (const entry of requested) {
            const object = objectsByKey.get(entry.key);
            if (!object) {
                results.push({ key: entry.key, action: 'trash', status: 'already-missing' });
                continue;
            }

            const trashKey = `_trash/${date}/${entry.key}`;
            const copied = await r2.put(trashKey, object.bytes, {
                contentType: object.contentType,
                customMetadata: {
                    ...object.customMetadata,
                    originalKey: entry.key,
                    trashedAt: new Date().toISOString(),
                },
                onlyIfMissing: true,
            });
            if (!copied) return json({ error: `Trash already contains ${trashKey}; source was not removed` }, 409);
            await r2.delete(entry.key);
            results.push({ key: entry.key, action: 'trash', trashKey, status: 'complete' });
            }

            for (const entry of requestedMarkers) {
            const marker = markersByKey.get(entry.key);
            if (!marker) {
                results.push({ key: entry.key, action: 'delete-marker', status: 'already-missing' });
                continue;
            }
            await r2.delete(entry.key);
            results.push({ key: entry.key, action: 'delete-marker', status: 'complete' });
            }

            return json({ success: true, results });
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'R2 Trash operation failed';
        return json({ error: message }, 500);
    }
};
// Registered only by the local development server.
