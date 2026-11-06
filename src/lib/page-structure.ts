import type { AlbumBlock } from './albums/types';

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
const photoKey = (photo: PagePhoto) => photo.itemKey || '';

/** Undefined optional fields are dropped so stored blocks stay minimal. */
const compact = <T extends object>(value: T): T =>
    Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

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

const isCarouselLike = (block?: PageBlock) => block?.type === 'PhotoCarousel' || block?.type === 'PhotoPanorama';

// Mirrors the rendered margin with no blockMargin set: Text writes its own
// inline 0.5rem, the last block has none, and a Carousel or Panorama promotes
// its own and the preceding block's bottom margin to 1.5rem.
function defaultBlockMargin(blocks: PageBlock[], index: number) {
    if (blocks[index].type === 'Text') return '0.5';
    if (index === blocks.length - 1) return '0';
    return isCarouselLike(blocks[index]) || isCarouselLike(blocks[index + 1]) ? '1.5' : '0.5';
}

// Only a margin that differs from the rendered default is stored, so an
// explicit 0.5rem next to a Carousel survives.
function blockMarginProp(blocks: PageBlock[], index: number) {
    const props = blocks[index].props || {};
    const value = props.blockMargin || props.mb;
    const margin = remNumber(value);
    return margin && margin !== defaultBlockMargin(blocks, index) ? String(value) : undefined;
}

const positiveInteger = (value: unknown, max: number) =>
    Math.min(max, Math.max(0, Math.trunc(Number(value) || 0)));

/** Converts the Page Manager draft into stored blocks, dropping default-valued props. */
export function pageBlocksToAlbumBlocks(blocks: PageBlock[]): AlbumBlock[] {
    // A media block emptied by the editor has nothing to render.
    const kept = blocks.filter((block) => block.type === 'Text' || (block.photos || []).length > 0);
    return kept.map((block, index): AlbumBlock => {
        const props = block.props || {};
        const blockMargin = blockMarginProp(kept, index);
        if (block.type === 'Text') {
            return compact({
                type: 'Text',
                align: props.align && props.align !== 'center' ? props.align : undefined,
                size: props.size && props.size !== 'caption' ? props.size : undefined,
                blockMargin,
                text: block.text || '',
            });
        }

        const photos = block.photos || [];
        const media = {
            caption: props.caption || undefined,
            captionPosition: props.captionPosition && props.captionPosition !== 'center bottom'
                ? props.captionPosition
                : undefined,
            blockMargin,
        };
        if (block.type === 'Row') {
            return compact({
                type: 'Row',
                ...media,
                photos: rowCells(photos).map((cell) => cell.column
                    ? { column: photos.slice(cell.start, cell.end).map(photoKey) }
                    : photoKey(photos[cell.start])),
            });
        }
        if (block.type === 'PhotoCarousel') {
            return compact({
                type: 'PhotoCarousel',
                ...media,
                initialSlide: positiveInteger(props.initialSlide, Number.MAX_SAFE_INTEGER) || undefined,
                peekPercent: positiveInteger(props.peekPercent, 90) || undefined,
                photos: photos.map(photoKey),
            });
        }
        if (block.type === 'PhotoPanorama') {
            const panoramaSlices = Math.max(1, positiveInteger(props.panoramaSlices, 24));
            return compact({
                type: 'PhotoPanorama',
                ...media,
                initialSlide: positiveInteger(props.initialSlide, Number.MAX_SAFE_INTEGER) || undefined,
                initialView: props.initialView === 'panorama' ? 'panorama' : undefined,
                panoramaSlices: photos.length === 1 && panoramaSlices > 1 ? panoramaSlices : undefined,
                photos: photos.map(photoKey),
            });
        }
        throw new Error(`Unsupported page block type: ${block.type}`);
    });
}

/** Converts stored blocks into the Page Manager draft; Row Columns get fresh column ids. */
export function albumBlocksToPageBlocks(blocks: AlbumBlock[]): PageBlock[] {
    let columnCount = 0;
    return blocks.map((block) => {
        if (block.type === 'Text') {
            const { type, text, ...props } = block;
            return { type, props, text, photos: [] };
        }
        const { type, photos, ...props } = block;
        if (block.type !== 'Row') {
            return { type, props, photos: block.photos.map((itemKey) => ({ itemKey })) };
        }
        return {
            type,
            props,
            photos: block.photos.flatMap((item) => {
                if (typeof item === 'string') return [{ itemKey: item }];
                const column = `column-${columnCount++}`;
                return item.column.map((itemKey) => ({ itemKey, column }));
            }),
        };
    });
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
