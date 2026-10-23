type PagePhoto = { itemKey?: string; column?: string };

type PageBlock = {
    type: string;
    props?: Record<string, any>;
    photos?: PagePhoto[];
    text?: string;
    __devKey?: string;
};

export type RowCell = { start: number; end: number; column?: string };
export type MoveDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Photos stay a flat list; consecutive Row photos sharing a column id form one
 * Column cell. A lone member is a plain photo, so emptied Columns dissolve.
 */
export function rowCells(photos: PagePhoto[] = []): RowCell[] {
    const cells: RowCell[] = [];
    photos.forEach((photo, index) => {
        const last = cells[cells.length - 1];
        if (photo.column && last?.column === photo.column) last.end = index + 1;
        else cells.push({ start: index, end: index + 1, column: photo.column });
    });
    return cells.map((cell) => (cell.end - cell.start > 1 ? cell : { start: cell.start, end: cell.end }));
}

const photoName = (photo: PagePhoto) => (photo.itemKey || '').replace(/^.*\//, '');

function findPhoto(blocks: PageBlock[], name: string) {
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const photoIndex = (blocks[blockIndex].photos || []).findIndex((photo) => photoName(photo) === name);
        if (photoIndex >= 0) return { blockIndex, photoIndex };
    }
    return null;
}

function cellAt(block: PageBlock, photoIndex: number): RowCell {
    if (block.type !== 'Row') return { start: photoIndex, end: photoIndex + 1 };
    return rowCells(block.photos).find((cell) => cell.start <= photoIndex && photoIndex < cell.end)!;
}

/**
 * Moves a photo, or the whole Column holding it, next to a target photo.
 * Left/right lands beside the target's Row cell; up/down joins the target's
 * Column or stacks with it as a new one. Returns false for invalid drops.
 */
export function movePagePhotos(
    blocks: PageBlock[],
    source: { level: 'photo' | 'column'; photoName: string },
    targetPhotoName: string,
    direction: MoveDirection,
    createColumnId: () => string,
) {
    const from = findPhoto(blocks, source.photoName);
    const target = findPhoto(blocks, targetPhotoName);
    if (!from || !target) return false;
    const sourceCell = source.level === 'column'
        ? cellAt(blocks[from.blockIndex], from.photoIndex)
        : { start: from.photoIndex, end: from.photoIndex + 1 };
    const sourcePhotos = blocks[from.blockIndex].photos!.slice(sourceCell.start, sourceCell.end);
    if (sourcePhotos.some((photo) => photoName(photo) === targetPhotoName)) return false;
    const vertical = direction === 'up' || direction === 'down';
    if (blocks[target.blockIndex].type !== 'Row' && (vertical || source.level === 'column')) return false;

    blocks[from.blockIndex].photos!.splice(sourceCell.start, sourcePhotos.length);
    if (blocks[from.blockIndex].photos!.length === 0) blocks.splice(from.blockIndex, 1);
    const moved = sourcePhotos.map((photo) => ({ ...photo }));
    if (source.level === 'photo') delete moved[0].column;

    const to = findPhoto(blocks, targetPhotoName)!;
    const block = blocks[to.blockIndex];
    const photos = block.photos!;
    const cell = cellAt(block, to.photoIndex);
    const before = direction === 'up' || direction === 'left';
    if (!vertical) {
        photos.splice(before ? cell.start : cell.end, 0, ...moved);
        return true;
    }

    const column = cell.column ?? createColumnId();
    photos[to.photoIndex].column = column;
    moved.forEach((photo) => { photo.column = column; });
    photos.splice(before ? to.photoIndex : to.photoIndex + 1, 0, ...moved);
    return true;
}

export function movePageBlock(
    blocks: PageBlock[],
    sourceKey: string,
    targetKey: string,
    direction: 'up' | 'down',
) {
    if (sourceKey === targetKey) return false;
    const sourceIndex = blocks.findIndex((block) => block.__devKey === sourceKey);
    if (sourceIndex < 0 || !blocks.some((block) => block.__devKey === targetKey)) return false;
    const [moved] = blocks.splice(sourceIndex, 1);
    const targetIndex = blocks.findIndex((block) => block.__devKey === targetKey);
    blocks.splice(direction === 'up' ? targetIndex : targetIndex + 1, 0, moved);
    return true;
}

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
        const isPanorama = block.type === 'PhotoPanorama';
        if ((block.type === 'PhotoCarousel' || isPanorama) && props.initialSlide) {
            propsText += `\n  initialSlide={${props.initialSlide}}`;
        }
        const peekPercent = Math.min(90, Math.max(0, Math.trunc(Number(props.peekPercent) || 0)));
        if (block.type === 'PhotoCarousel' && peekPercent > 0) {
            propsText += `\n  peekPercent={${peekPercent}}`;
        }
        if (isPanorama && props.initialView === 'panorama') {
            propsText += `\n  initialView="panorama"`;
        }
        const panoramaSlices = Math.min(24, Math.max(1, Math.trunc(Number(props.panoramaSlices) || 1)));
        if (isPanorama && block.photos?.length === 1 && panoramaSlices > 1) {
            propsText += `\n  panoramaSlices={${panoramaSlices}}`;
        }
        if (!props.blockMargin && remNumber(props.mb) && remNumber(props.mb) !== '0.5') {
            propsText += `\n  blockMargin="${props.mb}"`;
        }

        body += `<${block.type}${propsText}>\n`;
        const photos = block.photos || [];
        const cells = block.type === 'Row'
            ? rowCells(photos)
            : photos.map((_, index) => ({ start: index, end: index + 1 }) as RowCell);
        for (const cell of cells) {
            const members = photos.slice(cell.start, cell.end);
            if (!cell.column) {
                body += `  <Photo itemKey="${members[0].itemKey}" />\n`;
                continue;
            }
            body += '  <Column>\n';
            for (const photo of members) body += `    <Photo itemKey="${photo.itemKey}" />\n`;
            body += '  </Column>\n';
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
