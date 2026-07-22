import type { APIRoute } from 'astro';

import { updatePhotoCaption } from '../lib/albums/manifest-files';

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let body: {
        action?: 'update' | 'delete';
        albumSlug?: string;
        filename?: string;
        caption?: string;
    };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { action, albumSlug, filename } = body;
    if ((action !== 'update' && action !== 'delete') || !albumSlug || !filename) {
        return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    if (action === 'update' && typeof body.caption !== 'string') {
        return new Response(JSON.stringify({ error: 'Caption must be a string' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        await updatePhotoCaption(
            process.cwd(),
            albumSlug,
            filename,
            action === 'update' ? body.caption : undefined,
        );
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to save photo caption' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
    }
};
// Registered only by the local development server.
