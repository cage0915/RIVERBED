import type { APIRoute } from 'astro';
import { createPageContent } from '../../lib/page-structure';

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
        });
    }

    const fs = await import('node:fs');
    const path = await import('node:path');

    let body: { albumSlug: string; blocks: any[] };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
    }

    const { albumSlug, blocks, frontmatter: newFrontmatter } = body as any;
    if (!albumSlug || !blocks) {
        return new Response(JSON.stringify({ error: 'Missing albumSlug or blocks' }), { status: 400 });
    }

    const mdxFile = path.resolve(process.cwd(), 'src/content/albums', `${albumSlug}.mdx`);
    if (!fs.existsSync(mdxFile)) {
        return new Response(JSON.stringify({ error: 'MDX file not found' }), { status: 404 });
    }

    const originalContent = fs.readFileSync(mdxFile, 'utf-8');
    const fmMatch = originalContent.match(/^---\n([\s\S]*?)\n---/);
    const originalFrontmatter = fmMatch ? fmMatch[0] : '';

    const newContent = createPageContent(originalContent, blocks, newFrontmatter || originalFrontmatter);
    fs.writeFileSync(mdxFile, newContent, 'utf-8');

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
