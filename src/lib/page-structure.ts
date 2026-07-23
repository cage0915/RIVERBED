type PageBlock = {
    type: string;
    props?: Record<string, any>;
    photos?: Array<{ itemKey?: string }>;
    text?: string;
};

export function serializePageBody(blocks: PageBlock[]) {
    let body = '';
    for (const block of blocks) {
        const props = block.props || {};
        if (block.type === 'Text') {
            let propsText = '';
            if (props.align && props.align !== 'center') propsText += `\n  align="${props.align}"`;
            if (props.size && props.size !== 'caption') propsText += `\n  size="${props.size}"`;
            if (props.mt && props.mt !== '2rem') propsText += `\n  mt="${props.mt}"`;
            if (props.mb && props.mb !== '0.5rem') propsText += `\n  mb="${props.mb}"`;
            body += `<Text${propsText}>\n  ${block.text || ''}\n</Text>\n\n`;
            continue;
        }

        let propsText = '';
        if (props.caption) propsText += `\n  caption="${props.caption}"`;
        if (props.captionPosition && props.captionPosition !== 'center bottom') propsText += `\n  captionPosition="${props.captionPosition}"`;
        if (props.captionMargin) propsText += `\n  captionMargin="${props.captionMargin}"`;
        if (props.blockMargin) propsText += `\n  blockMargin="${props.blockMargin}"`;
        if (block.type === 'PhotoCarousel' && props.initialSlide) propsText += `\n  initialSlide={${props.initialSlide}}`;
        if (!props.captionMargin && props.caption && props.mt) propsText += `\n  captionMargin="${props.mt}"`;
        if (!props.blockMargin && !props.captionMargin && props.mb) propsText += `\n  blockMargin="${props.mb}"`;

        body += `<${block.type}${propsText}>\n`;
        for (const photo of block.photos || []) {
            body += `  <Photo itemKey="${photo.itemKey}" />\n`;
        }
        body += `</${block.type}>\n\n`;
    }
    return body.trim();
}

export function createPageContent(originalContent: string, blocks: PageBlock[], requestedFrontmatter?: string) {
    const originalMatch = originalContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let frontmatter = requestedFrontmatter || originalMatch?.[0] || '';
    if (frontmatter && !frontmatter.startsWith('---')) frontmatter = `---\n${frontmatter}\n---`;
    frontmatter = frontmatter.replace(/^order:\s*.*$\n?/m, '');
    return `${frontmatter}\n\n${serializePageBody(blocks)}\n`;
}

export function createLayoutOnlyPageContent(blocks: PageBlock[]) {
    return `---\n---\n\n${serializePageBody(blocks)}\n`;
}

export function referencedLocalNames(blocks: PageBlock[], frontmatter = '') {
    const names = new Set<string>();
    const add = (value?: string) => {
        const normalized = String(value || '').replace(/^\/+/, '');
        if (normalized) names.add(normalized.split('/').pop()!);
    };
    for (const block of blocks) for (const photo of block.photos || []) add(photo.itemKey);
    add(frontmatter.match(/^coverKey:\s*["']([^"']+)["']/m)?.[1]);
    return names;
}
