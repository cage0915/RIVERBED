import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
    console.log('Locals keys:', Object.keys(locals || {}));

    try {
        const runtime = locals.runtime;
        if (!runtime) {
            console.log('Runtime is missing');
            return new Response('Error: locals.runtime is missing. Are we running in Cloudflare adapter mode?', { status: 200 });
        }

        const env = runtime.env;
        if (!env) {
            console.log('Env is missing');
            return new Response('Error: locals.runtime.env is missing.', { status: 200 });
        }

        const bucket = env.R2_BUCKET;
        if (!bucket) {
            console.log('Bucket is missing. Env keys:', Object.keys(env));
            return new Response('Error: R2_BUCKET binding is missing in env. Keys: ' + Object.keys(env).join(', '), { status: 200 });
        }

        // Create a simple SVG placeholder image
        const svgContent = `<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#555"/><text x="50%" y="50%" font-size="24" text-anchor="middle" fill="white">Mountain Vista Preview</text></svg>`;

        await bucket.put('m01.jpg', svgContent, {
            httpMetadata: {
                contentType: 'image/svg+xml',
            }
        });

        return new Response('Seeded R2 with m01.jpg (SVG placeholder)', { status: 200 });
    } catch (error: any) {
        console.error('Seeding error:', error);
        return new Response(`Seeding failed: ${error.message}`, { status: 200 });
    }
};
