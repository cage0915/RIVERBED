import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
        });
    }

    let body: { action: 'update' | 'delete'; albumSlug?: string; blockIndex?: number; caption?: string; captionPosition?: string; padding?: string };
    try { body = await request.json(); }
    catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

    const { action, albumSlug, blockIndex, caption, captionPosition, padding } = body;
    if (!action || !albumSlug || blockIndex == null) {
        return new Response(JSON.stringify({ error: 'Missing required parameters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const fs = await import('node:fs');
    const path = await import('node:path');
    const mdxFile = path.resolve(process.cwd(), 'src/content/albums', `${albumSlug}.mdx`);
    if (!fs.existsSync(mdxFile)) {
        return new Response(JSON.stringify({ error: 'MDX file not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const content = fs.readFileSync(mdxFile, 'utf-8');

    const tagPattern = /<(Row|PhotoCarousel)\b([\s\S]*?)>/g;
    const matches: { index: number; full: string; tagName: string; props: string }[] = [];
    let m;
    while ((m = tagPattern.exec(content)) !== null) {
        matches.push({ index: m.index, full: m[0], tagName: m[1], props: m[2] });
    }

    if (blockIndex >= matches.length) {
        return new Response(JSON.stringify({ error: `Block ${blockIndex} not found` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const target = matches[blockIndex];

    let cleaned = target.props
        .replace(/\s*caption="[^"]*"/g, '')
        .replace(/\s*captionPosition="[^"]*"/g, '')
        .replace(/\s*padding="[^"]*"/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    let newTag = '';
    if (action === 'update') {
        const additions: string[] = [];
        if (caption) additions.push(`caption="${caption}"`);
        if (captionPosition && captionPosition !== 'center bottom') additions.push(`captionPosition="${captionPosition}"`);
        if (padding) additions.push(`padding="${padding}"`);

        const allParts = [cleaned, ...additions].filter(Boolean);
        newTag = allParts.length > 0
            ? `<${target.tagName}\n    ${allParts.join('\n    ')}\n>`
            : `<${target.tagName}>`;
    } else {
        // delete action
        newTag = cleaned ? `<${target.tagName} ${cleaned}>` : `<${target.tagName}>`;
    }

    const newContent = content.slice(0, target.index) + newTag + content.slice(target.index + target.full.length);
    fs.writeFileSync(mdxFile, newContent, 'utf-8');

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
