import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
        });
    }

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

    let newBody = '';

    blocks.forEach((block) => {
        const { type, props, photos } = block;
        let propsStr = '';
        if (props.caption) propsStr += `\n  caption="${props.caption}"`;
        if (props.captionPosition && props.captionPosition !== 'center bottom') {
            propsStr += `\n  captionPosition="${props.captionPosition}"`;
        }
        if (props.padding) propsStr += `\n  padding="${props.padding}"`;

        newBody += `<${type}${propsStr}>\n`;
        photos.forEach((photo: any) => {
            newBody += `  <Photo itemKey="${photo.itemKey}" />\n`;
        });
        newBody += `</${type}>\n\n`;
    });

    let finalFrontmatter = newFrontmatter || originalFrontmatter;
    if (finalFrontmatter && !finalFrontmatter.startsWith('---')) {
        finalFrontmatter = `---\n${finalFrontmatter}\n---`;
    }

    const newContent = `${finalFrontmatter}\n\n${newBody.trim()}\n`;
    fs.writeFileSync(mdxFile, newContent, 'utf-8');

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
