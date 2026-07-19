import type { APIRoute } from 'astro';

import { getR2AdminClient } from '../../lib/r2-admin-client';
import { loadR2SourceIndex } from '../../lib/r2-source-files';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

type TrashRequest = { key?: string; etag?: string };

export const POST: APIRoute = async ({ request, locals }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);
    const r2 = await getR2AdminClient(locals.runtime?.env?.RIVERBED);
    if (!r2) return json({ error: 'Remote R2 is unavailable. Configure the R2 credentials in .env.' }, 503);

    try {
        const body = await request.json() as { objects?: TrashRequest[]; markers?: TrashRequest[] };
        const objects = Array.isArray(body.objects) ? body.objects : [];
        const markers = Array.isArray(body.markers) ? body.markers : [];
        if (objects.length + markers.length === 0 || objects.length + markers.length > 100) {
            return json({ error: 'Select between 1 and 100 objects or folder markers' }, 400);
        }

        const sourceIndex = loadR2SourceIndex();
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
            const references = sourceIndex.get(entry.key) || [];
            if (references.length) return json({ error: `${entry.key} is now referenced by source`, references }, 409);
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

        const date = new Date().toISOString().slice(0, 10);
        const results: Array<{ key: string; action: 'trash' | 'delete-marker'; trashKey?: string; status: string }> = [];
        for (const entry of requested) {
            const object = await r2.get(entry.key);
            if (!object) {
                results.push({ key: entry.key, action: 'trash', status: 'already-missing' });
                continue;
            }
            if (object.etag !== entry.etag) {
                return json({ error: `${entry.key} changed after the audit; refresh and try again` }, 409);
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
            const marker = await r2.head(entry.key);
            if (!marker) {
                results.push({ key: entry.key, action: 'delete-marker', status: 'already-missing' });
                continue;
            }
            if (marker.etag !== entry.etag) {
                return json({ error: `${entry.key} changed after the audit; refresh and try again` }, 409);
            }
            if (marker.size !== 0) {
                return json({ error: `${entry.key} is not an empty folder marker and was not deleted` }, 409);
            }
            await r2.delete(entry.key);
            results.push({ key: entry.key, action: 'delete-marker', status: 'complete' });
        }

        return json({ success: true, results });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'R2 Trash operation failed';
        return json({ error: message }, 500);
    }
};
