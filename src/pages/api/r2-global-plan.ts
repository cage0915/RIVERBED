import type { APIRoute } from 'astro';

import { loadR2SourceIndex } from '../../lib/r2-source-files';
import { getR2AdminClient } from '../../lib/r2-admin-client';
import { classifyRemoteObjects } from '../../lib/r2-source-index';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

export const GET: APIRoute = async ({ locals }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);
    const sourceIndex = loadR2SourceIndex();
    const r2 = await getR2AdminClient(locals.runtime?.env?.RIVERBED);
    if (!r2) {
        return json({
            remoteAvailable: false,
            sourceCount: sourceIndex.size,
            message: 'Remote R2 is unavailable. Configure the R2 credentials in .env and restart the development server.',
        });
    }
    try {
        const remote = (await r2.list()).map((object) => ({
                key: object.key,
                size: object.size,
                etag: object.etag,
                uploaded: object.uploaded.toISOString(),
            }));
        const remoteKeys = new Set(remote.map((entry) => entry.key));
        const sourceMissing = [...sourceIndex.entries()]
            .filter(([key]) => !remoteKeys.has(key))
            .map(([key, references]) => ({ key, references }));
        const { trash, orphans, directoryMarkers } = classifyRemoteObjects(remote, sourceIndex);
        return json({
            remoteAvailable: true,
            sourceCount: sourceIndex.size,
            remoteCount: remote.length,
            remoteBytes: remote.reduce((sum, entry) => sum + entry.size, 0),
            sourceMissing,
            orphans,
            trash,
            directoryMarkers,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'R2 audit failed';
        return json({ error: message }, 502);
    }
};
