import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

export const GET: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
        });
    }

    const url = new URL(request.url);
    const albumSlug = url.searchParams.get('albumSlug');

    if (!albumSlug) {
        return new Response(JSON.stringify({ error: 'Missing albumSlug' }), { status: 400 });
    }

    const mdxFile = path.resolve(process.cwd(), 'src/content/albums', `${albumSlug}.mdx`);
    if (!fs.existsSync(mdxFile)) {
        return new Response(JSON.stringify({ error: 'MDX file not found' }), { status: 404 });
    }

    const content = fs.readFileSync(mdxFile, 'utf-8');

    // Simple parser for MDX blocks
    // 1. Extract Frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content;

    // 2. Extract Blocks
    // Regex to match <Row ...>...</Row>, <PhotoCarousel ...>...</PhotoCarousel>, or <Text ...>...</Text>
    const blockRegex = /<(Row|PhotoCarousel|Text)\b([^>]*?)>([\s\S]*?)<\/\1>/g;
    const blocks: any[] = [];
    let match;

    while ((match = blockRegex.exec(body)) !== null) {
        const type = match[1];
        const propsStr = match[2];
        const innerContent = match[3];

        // Handle Text blocks separately
        if (type === 'Text') {
            const props: any = {};
            const alignMatch = propsStr.match(/align="([^"]*)"/);
            if (alignMatch) props.align = alignMatch[1];
            const sizeMatch = propsStr.match(/size="([^"]*)"/);
            if (sizeMatch) props.size = sizeMatch[1];
            const mtMatch = propsStr.match(/mt="([^"]*)"/);
            if (mtMatch) props.mt = mtMatch[1];
            const mbMatch = propsStr.match(/mb="([^"]*)"/);
            if (mbMatch) props.mb = mbMatch[1];
            blocks.push({ type: 'Text', props, text: innerContent.trim(), photos: [] });
            continue;
        }

        // Parse Block Props (Row / PhotoCarousel)
        const props: any = {};
        const captionMatch = propsStr.match(/caption="([^"]*)"/);
        if (captionMatch) props.caption = captionMatch[1];

        const posMatch = propsStr.match(/captionPosition="([^"]*)"/);
        if (posMatch) props.captionPosition = posMatch[1];

        const paddingMatch = propsStr.match(/padding="([^"]*)"/);
        if (paddingMatch) props.padding = paddingMatch[1];

        const mbMatch = propsStr.match(/mb="([^"]*)"/);
        if (mbMatch) props.mb = mbMatch[1];

        const mtMatch = propsStr.match(/mt="([^"]*)"/);
        if (mtMatch) props.mt = mtMatch[1];

        const blockMarginMatch = propsStr.match(/blockMargin="([^"]*)"/);
        if (blockMarginMatch) props.blockMargin = blockMarginMatch[1];

        const captionMarginMatch = propsStr.match(/captionMargin="([^"]*)"/);
        if (captionMarginMatch) props.captionMargin = captionMarginMatch[1];

        const initialSlideMatch = propsStr.match(/initialSlide=\{(\d+)\}/);
        if (initialSlideMatch) props.initialSlide = parseInt(initialSlideMatch[1]);

        // Parse Photos inside Block
        const photoRegex = /<Photo\s+([^>]*?)\/>/g;
        const photos: any[] = [];
        let pMatch;
        while ((pMatch = photoRegex.exec(innerContent)) !== null) {
            const pPropsStr = pMatch[1];
            const itemKeyMatch = pPropsStr.match(/itemKey="([^"]*)"/);
            if (itemKeyMatch) {
                photos.push({ itemKey: itemKeyMatch[1] });
            }
        }

        blocks.push({
            type,
            props,
            photos
        });
    }

    return new Response(JSON.stringify({ frontmatter, blocks }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
