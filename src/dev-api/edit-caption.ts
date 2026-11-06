import type { APIRoute } from 'astro';

import { updatePhotoCaption } from '../lib/albums/manifest-files';
import { json } from './_http';

export const POST: APIRoute = async ({ request }) => {
    let body: {
        action?: 'update' | 'delete';
        albumSlug?: string;
        filename?: string;
        caption?: string;
    };
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON' }, 400);
    }

    const { action, albumSlug, filename } = body;
    if ((action !== 'update' && action !== 'delete') || !albumSlug || !filename) {
        return json({ error: 'Missing required parameters' }, 400);
    }
    if (action === 'update' && typeof body.caption !== 'string') {
        return json({ error: 'Caption must be a string' }, 400);
    }

    try {
        await updatePhotoCaption(
            process.cwd(),
            albumSlug,
            filename,
            action === 'update' ? body.caption : undefined,
        );
        return json({ success: true });
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Unable to save photo caption' }, 400);
    }
};
// Registered only by the local development server.
