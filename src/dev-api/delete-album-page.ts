import type { APIRoute } from 'astro';
import path from 'node:path';
import trash from 'trash';
import { AlbumLifecycleConflictError, deleteAlbumSourceFiles } from '../lib/albums/album-lifecycle';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);
    try {
        const body = await request.json() as { pagePath?: string };
        const pagePath = String(body.pagePath || '').replace(/^\/+|\/+$/g, '');
        if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(pagePath)) return json({ error: 'Invalid page path' }, 400);

        const projectRoot = process.cwd();
        const sources = await deleteAlbumSourceFiles(
            projectRoot,
            pagePath,
            (paths) => trash(paths, { glob: false }),
        );
        return json({
            success: true,
            pagePath,
            trashed: sources.map((source) => path.relative(projectRoot, source).split(path.sep).join('/')),
            localPhotosPreserved: true,
        });
    } catch (error) {
        if (error instanceof AlbumLifecycleConflictError) {
            return json({ error: error.message, consumers: error.consumerSlugs }, 409);
        }
        if (error instanceof Error && /manifest not found/i.test(error.message)) {
            return json({ error: 'Page does not exist' }, 404);
        }
        return json({ error: error instanceof Error ? error.message : 'Page deletion failed' }, 500);
    }
};
// Registered only by the local development server.
