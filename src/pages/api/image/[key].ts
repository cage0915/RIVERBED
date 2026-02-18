import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
    const { key } = params;

    if (!key) {
        return new Response('Missing key', { status: 400 });
    }

    try {
        const bucket = locals.runtime.env.R2_BUCKET;
        const object = await bucket.get(key);

        if (!object) {
            return new Response('Image not found', { status: 404 });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers as any);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');

        return new Response(object.body as any, {
            headers,
        });
    } catch (error) {
        console.error('Error fetching image:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
};
