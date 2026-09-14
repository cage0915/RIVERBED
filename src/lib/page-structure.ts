type PageBlock = {
    type: string;
    props?: Record<string, any>;
    photos?: Array<{ itemKey?: string }>;
    text?: string;
};

function remNumber(value: unknown) {
    const text = String(value ?? '').trim().replace(/rem$/i, '').trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return '';
    const number = Number(text);
    return Number.isFinite(number) ? String(Object.is(number, -0) ? 0 : number) : '';
}

export function applyDefaultCaptionBoundaryMargin(
    blocks: PageBlock[],
    blockIndex: number,
) {
    const block = blocks[blockIndex];
    if (!block || block.type === 'Text') return false;

    const captionIsTop = block.props?.captionPosition?.includes('top');
    const targetIndex = captionIsTop ? blockIndex - 1 : blockIndex;
    const hasAdjacentBlock = captionIsTop ? blockIndex > 0 : blockIndex < blocks.length - 1;
    if (!hasAdjacentBlock) return false;

    const target = blocks[targetIndex];
    target.props ||= {};
    const property = 'blockMargin';
    const currentValue = remNumber(target.props[property]);

    // Initialize caption spacing without replacing a margin the user customized.
    if (currentValue) return false;
    target.props[property] = '1.5rem';
    return true;
}

export function serializePageBody(blocks: PageBlock[]) {
    let body = '';
    for (const block of blocks) {
        const props = block.props || {};
        if (block.type === 'Text') {
            let propsText = '';
            if (props.align && props.align !== 'center') propsText += `\n  align="${props.align}"`;
            if (props.size && props.size !== 'caption') propsText += `\n  size="${props.size}"`;
            if (remNumber(props.blockMargin) && remNumber(props.blockMargin) !== '0.5') {
                propsText += `\n  blockMargin="${props.blockMargin}"`;
            }
            if (!props.blockMargin && remNumber(props.mb) && remNumber(props.mb) !== '0.5') {
                propsText += `\n  blockMargin="${props.mb}"`;
            }
            body += `<Text${propsText}>\n  ${block.text || ''}\n</Text>\n\n`;
            continue;
        }

        let propsText = '';
        if (props.caption) propsText += `\n  caption="${props.caption}"`;
        if (props.captionPosition && props.captionPosition !== 'center bottom') propsText += `\n  captionPosition="${props.captionPosition}"`;
        if (remNumber(props.blockMargin) && remNumber(props.blockMargin) !== '0.5') {
            propsText += `\n  blockMargin="${props.blockMargin}"`;
        }
        if (block.type === 'PhotoCarousel' && props.enablePanorama === true) {
            propsText += `\n  enablePanorama={true}`;
        }
        if (block.type === 'PhotoCarousel' && props.initialSlide) {
            propsText += `\n  initialSlide={${props.initialSlide}}`;
        }
        if (block.type === 'PhotoCarousel' && props.enablePanorama === true && props.initialView === 'panorama') {
            propsText += `\n  initialView="panorama"`;
        }
        const panoramaSlices = Math.min(24, Math.max(1, Math.trunc(Number(props.panoramaSlices) || 1)));
        if (block.type === 'PhotoCarousel'
            && props.enablePanorama === true
            && block.photos?.length === 1
            && panoramaSlices > 1) {
            propsText += `\n  panoramaSlices={${panoramaSlices}}`;
        }
        if (!props.blockMargin && remNumber(props.mb) && remNumber(props.mb) !== '0.5') {
            propsText += `\n  blockMargin="${props.mb}"`;
        }

        body += `<${block.type}${propsText}>\n`;
        for (const photo of block.photos || []) {
            body += `  <Photo itemKey="${photo.itemKey}" />\n`;
        }
        body += `</${block.type}>\n\n`;
    }
    return body.trim();
}

export function createLayoutOnlyPageContent(blocks: PageBlock[]) {
    return `---\n---\n\n${serializePageBody(blocks)}\n`;
}

export function referencedLocalNames(blocks: PageBlock[]) {
    const names = new Set<string>();
    const add = (value?: string) => {
        const normalized = String(value || '').replace(/^\/+/, '');
        if (normalized) names.add(normalized.split('/').pop()!);
    };
    for (const block of blocks) for (const photo of block.photos || []) add(photo.itemKey);
    return names;
}
