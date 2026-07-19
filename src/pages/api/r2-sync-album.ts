import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { loadR2SourceIndex } from '../../lib/r2-source-files';
import { getR2AdminClient } from '../../lib/r2-admin-client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const isAlbumSlug = (value: string) => /^[a-z0-9-]+\/[a-z0-9-]+$/.test(value);

export const POST: APIRoute = async ({ request, locals }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);
    const r2 = await getR2AdminClient(locals.runtime?.env?.RIVERBED);
    if (!r2) return json({ error: 'Remote R2 is unavailable. Configure the R2 credentials in .env.' }, 503);

    try {
        const body = await request.json() as {
            albumSlug?: string;
            actions?: Array<{ action?: 'download' | 'upload' | 'overwrite' | 'trash'; key?: string; etag?: string }>;
        };
        const albumSlug = String(body.albumSlug || '');
        if (!isAlbumSlug(albumSlug) || !Array.isArray(body.actions)) return json({ error: 'Invalid sync plan' }, 400);
        const prefix = `${albumSlug}/`;
        const sourceIndex = loadR2SourceIndex();
        const results: Array<{ key: string; action: string; status: string; trashKey?: string }> = [];

        for (const requested of body.actions) {
            const key = String(requested.key || '').replace(/^\/+/, '');
            const action = requested.action;
            if (!key.startsWith(prefix) || !action || !['download', 'upload', 'overwrite', 'trash'].includes(action)) return json({ error: `Invalid object key or action: ${key}` }, 400);

            if (action === 'download') {
                const localPath = path.resolve(process.cwd(), 'r2', key);
                const allowedRoot = path.resolve(process.cwd(), 'r2', albumSlug) + path.sep;
                if (!localPath.startsWith(allowedRoot)) return json({ error: `Invalid download path: ${key}` }, 400);
                if (fs.existsSync(localPath)) {
                    results.push({ key, action, status: 'skipped-existing' });
                    continue;
                }
                const object = await r2.get(key);
                if (!object) {
                    results.push({ key, action, status: 'already-missing' });
                    continue;
                }
                fs.mkdirSync(path.dirname(localPath), { recursive: true });
                fs.writeFileSync(localPath, object.bytes);
                results.push({ key, action, status: 'complete' });
                continue;
            }

            if (action === 'upload' || action === 'overwrite') {
                if (!sourceIndex.has(key)) return json({ error: `Source no longer references ${key}` }, 409);
                const localPath = path.resolve(process.cwd(), 'r2', key);
                const allowedRoot = path.resolve(process.cwd(), 'r2', albumSlug) + path.sep;
                if (!localPath.startsWith(allowedRoot) || !fs.existsSync(localPath)) return json({ error: `Local photo not found: ${key}` }, 404);
                const bytes = fs.readFileSync(localPath);
                const sha256 = createHash('sha256').update(bytes).digest('hex');
                const extension = path.extname(localPath).toLowerCase();
                const contentType = extension === '.png' ? 'image/png'
                    : extension === '.webp' ? 'image/webp'
                        : extension === '.avif' ? 'image/avif' : 'image/jpeg';
                if (action === 'overwrite' && !requested.etag) return json({ error: `Missing overwrite ETag for ${key}` }, 400);
                const uploaded = await r2.put(key, bytes, {
                    contentType,
                    customMetadata: { sha256 },
                    etagMatches: action === 'overwrite' ? requested.etag! : undefined,
                    onlyIfMissing: action === 'upload',
                });
                if (!uploaded) return json({ error: `${key} changed after the dry run; refresh and try again` }, 409);
                results.push({ key, action, status: 'complete' });
                continue;
            }

            const references = sourceIndex.get(key) || [];
            if (references.length > 0) return json({ error: `${key} is still referenced`, references }, 409);
            const object = await r2.get(key);
            if (!object) {
                results.push({ key, action, status: 'already-missing' });
                continue;
            }
            const date = new Date().toISOString().slice(0, 10);
            const trashKey = `_trash/${date}/${key}`;
            await r2.put(trashKey, object.bytes, {
                contentType: object.contentType,
                customMetadata: {
                    ...object.customMetadata,
                    originalKey: key,
                    trashedAt: new Date().toISOString(),
                },
            });
            await r2.delete(key);
            results.push({ key, action, status: 'complete', trashKey });
        }
        return json({ success: true, results });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'R2 sync failed';
        return json({ error: message }, 500);
    }
};
