import type { APIRoute } from 'astro';
import { processAlbum } from '../../lib/album-utils';

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
        });
    }

    let body: { folder: string; albumSlug: string };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
    }

    const { folder, albumSlug } = body;
    if (!folder || !albumSlug) {
        return new Response(JSON.stringify({ error: 'Missing folder or albumSlug' }), { status: 400 });
    }

    try {
        const result = await processAlbum(folder, albumSlug);
        
        if (result.success) {
            return new Response(JSON.stringify({ 
                success: true, 
                redirectUrl: `/${folder}/${albumSlug}` 
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        } else {
            return new Response(JSON.stringify({ error: result.error }), { status: 500 });
        }

    } catch (err) {
        console.error(err);
        return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
    }
};
