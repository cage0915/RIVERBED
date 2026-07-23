// Registered only by the local development server.
import type { APIRoute } from 'astro';

import {
    AlbumRenamePlanError,
    AlbumSourceRollbackIncompleteError,
    executeAlbumPhotoRename,
} from '../lib/albums/album-lifecycle';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);
    let body: { albumSlug?: string; orderedKeys?: string[]; dryRun?: boolean };
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON' }, 400);
    }
    const albumSlug = String(body.albumSlug || '');
    const orderedKeys = body.orderedKeys;
    if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(albumSlug) || !Array.isArray(orderedKeys) || orderedKeys.length === 0) {
        return json({ error: 'Missing or invalid albumSlug or orderedKeys' }, 400);
    }
    if (orderedKeys.length > 10000 || orderedKeys.some((key) => typeof key !== 'string')) {
        return json({ error: 'Invalid photo keys' }, 400);
    }
    try {
        const result = body.dryRun
            ? await executeAlbumPhotoRename(process.cwd(), albumSlug, orderedKeys, {
                applyR2Plan: async () => async () => undefined,
                commitSourceFiles: async () => undefined,
            })
            : await executeAlbumPhotoRename(process.cwd(), albumSlug, orderedKeys);
        if (body.dryRun) {
            const blocking = result.items.filter(({ status }) => ['missing', 'conflict', 'duplicate'].includes(status));
            return json({
                dryRun: true,
                items: result.items,
                renameCount: result.items.filter(({ status }) => status === 'rename').length,
                unchangedCount: result.items.filter(({ status }) => status === 'unchanged').length,
                canExecute: blocking.length === 0 && Object.keys(result.renamed).length > 0,
            });
        }
        return json({ ok: true, renamed: result.renamed });
    } catch (error) {
        if (error instanceof AlbumSourceRollbackIncompleteError) {
            return json({
                error: error.message,
                code: error.code,
                outcome: error.outcome,
                recoveryArtifacts: error.recoveryArtifacts,
            }, 500);
        }
        if (error instanceof AlbumRenamePlanError) {
            if (body.dryRun) {
                return json({
                    dryRun: true,
                    items: error.items,
                    renameCount: error.items.filter(({ status }) => status === 'rename').length,
                    unchangedCount: error.items.filter(({ status }) => status === 'unchanged').length,
                    canExecute: false,
                });
            }
            return json({ error: error.message, items: error.items }, 409);
        }
        const message = error instanceof Error ? error.message : 'Photo rename failed';
        const status = /not found/i.test(message) ? 404
            : /blocking|duplicate|outside the source Album|Invalid photo/i.test(message) ? 409
                : 500;
        return json({ error: message }, status);
    }
};
