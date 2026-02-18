import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals, url }) => {
    const { path: imagePath = '' } = params;

    if (import.meta.env.DEV) {
        return Response.redirect(new URL(`/r2/${imagePath}`, url), 302);
    }

    try {
        const r2 = (locals as any).runtime?.env?.RIVERBED;
        if (!r2) return new Response('R2 binding not available', { status: 500 });

        const object = await r2.get(imagePath);
        if (!object) return new Response('Image not found', { status: 404 });

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');

        return new Response(object.body, { headers });
    } catch (error) {
        console.error('[API/Image] Error:', error);
        return new Response('Error fetching image', { status: 500 });
    }
};
