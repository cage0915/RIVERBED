// DEV-ONLY album editing tools; DevTool.astro is rendered only by `astro dev`.
import { addOrUpdateTag, collectTagNames, deleteTag as removeTagFromMap, normalizeTagMap } from "../../lib/dev-tag-state";
import { isMountainTagIndex, isMountainTagPage } from "../../lib/dev-route-state";
import { installPageLifecycle } from "../../lib/client-page-lifecycle";
import { remValueForInput, remValueFromInput } from "../../lib/rem-spacing";
import { applyDefaultCaptionBoundaryMargin, movePageBlock, movePagePhotos, rowCells, type MoveDirection, type RowCell } from "../../lib/page-structure";
import { measureRowItem, rowItemFlex } from "../../lib/photo-row-layout";
import { parseRichText } from "../../lib/rich-text";
import { R2_DOMAIN } from "../../lib/constants";
import { ICONS, showToast, escapeHtml, sortableInstances, loadSortable } from "./ui";
import { isLocalhost, getAlbumSlug, isFolderPage, isRootPage } from "./routes";
import { openAlbumSyncDialog } from "./album-sync";
import { openPhotoRenameDryRun } from "./photo-rename";
import { openRegionManager } from "./region-manager";
import { initFolderCoverEditors } from "./folder-cover";
import { openFolderManager } from "./folder-manager";
import { openR2Manager } from "./r2-manager";
import "./photo-fallback";

type MountainRegion = string;
type MountainRegionDefinition = { id: string; label: string };
type CachedMountain = {
    name: string;
    elevation: number | null;
    description: string;
    region: MountainRegion;
};
type MediaBlockType = 'Row' | 'PhotoCarousel' | 'PhotoPanorama';
const isCarouselLikeType = (type: unknown) => type === 'PhotoCarousel' || type === 'PhotoPanorama';
type PendingCaptionChange = {
    sourceType: MediaBlockType;
    blockIndex: number;
    photoNames: string[];
    caption: string;
    captionPosition: string;
    originalCaption: string;
    originalCaptionPosition: string;
};
type PendingTextChange = {
    sourceType: 'Text';
    blockKey?: string;
    blockIndex: number;
    text: string;
    align: 'left' | 'center' | 'right';
    textType: 'caption' | 'title';
    deleted: boolean;
    originalText: string;
    originalAlign: 'left' | 'center' | 'right';
    originalTextType: 'caption' | 'title';
};
type PendingBlockMarginChange = {
    sourceType: MediaBlockType | 'Text';
    blockKey?: string;
    blockIndex: number;
    photoNames: string[];
    blockMargin: string;
    originalBlockMargin: string;
    originalText?: string;
    automaticSpacingKey?: string;
};
type PendingBlockTypeChange = {
    sourceType: MediaBlockType;
    targetType: MediaBlockType;
    blockIndex: number;
    photoNames: string[];
};
type PageStructureDraft = {
    blocks: any[];
    metadata: {
        title: string;
        info?: string;
        gap?: string;
    };
    removeLocal: string[];
};
type PendingPageStructureChange = {
    albumSlug: string;
    draft: PageStructureDraft;
    imports: File[];
};
let mountainCache: CachedMountain[] = [];
let mountainRegions: MountainRegionDefinition[] = [];
let pendingMountainRegions: Record<string, MountainRegion> = {};
let savedAlbumTagMap: Record<string, { name: string; x: number; y: number }[]> = {};
let currentAlbumTagMap: Record<string, { name: string; x: number; y: number }[]> = {};
const pendingCaptionChanges = new Map<string, PendingCaptionChange>();
const pendingTextChanges = new Map<string, PendingTextChange>();
const pendingBlockMarginChanges = new Map<string, PendingBlockMarginChange>();
const pendingBlockTypeChanges = new Map<string, PendingBlockTypeChange>();
// Every layout operation edits one canonical draft. Order and block
// controls are separate interactions, not separate save snapshots.
let pendingLayoutChange: PendingPageStructureChange | null = null;
let pendingStructurePhotoNodes: Map<string, HTMLElement> | null = null;
const pendingStructureObjectUrls = new Map<File, string>();
let pendingSaveInProgress = false;
let activeTagMode = false;
let copiedTagName: string | null = null;
let activeBlockEditMode = false;
let pendingTextBlockEditorKey: string | null = null;
type InlineOrderPhotoAction = 'merge' | 'split' | null;
let inlineOrderPhotoAction: InlineOrderPhotoAction = null;
let inlineOrderSelectedPhotoNames = new Set<string>();
let inlineOrderLastSelectedPhotoName: string | null = null;
// One selection whose level grows on repeated clicks: photo -> column -> block.
type InlineOrderMove =
    | { level: 'photo' | 'column'; photoName: string; blockKey: string }
    | { level: 'block'; blockKey: string };
let inlineOrderMove: InlineOrderMove | null = null;
let inlineOrderInteractionAbortController: AbortController | null = null;
let activeMarginControl: HTMLElement | null = null;
type InlineBlockAction = {
    kind: 'delete-block' | 'delete-photos' | 'set-initial-photo';
    blockKey: string;
    fallbackIndex: number;
    selectedPhotos: Set<string>;
};
let activeInlineBlockAction: InlineBlockAction | null = null;
async function fetchMountains() {
    if (mountainCache.length > 0) return mountainCache;
    try {
        const res = await fetch("/api/get-data");
        if (res.ok) {
            const data = await res.json();
            mountainCache = data.mountains || [];
            mountainRegions = data.regions || [];
        }
    } catch {}
    return mountainCache;
}

const getTagKeyFromPhotoId = (photoId: string) => {
    const parts = photoId.split('/');
    if (parts.length < 3) return photoId;
    return parts.slice(2).join('/');
};

const getPhotoIdFromWrapper = (wrapper: HTMLElement) =>
    wrapper.dataset.itemKey || wrapper.dataset.panoramaSourceItemKey || '';

const setCopiedTagName = (name: string | null) => {
    copiedTagName = name;
    document.documentElement.classList.toggle('dev-tag-copy-active', Boolean(name));
    if (name) localStorage.setItem('devCopiedTagName', name);
    else localStorage.removeItem('devCopiedTagName');
};

const serializeTagMap = (tagMap: Record<string, { name: string; x: number; y: number }[]>) => {
    return JSON.stringify(normalizeTagMap(tagMap));
};

const syncToolbarPendingState = (toolbar: Element | null) => {
    if (!toolbar) return;
    const block = toolbar.closest<HTMLElement>('[data-dev-block]');
    toolbar.classList.toggle('has-pending', Boolean(
        block?.querySelector('.dev-toolbar-btn.has-pending, .dev-inline-margin-control.has-pending, .dev-inline-block-type-control.has-pending'),
    ));
};

const updateGlobalTagPendingIndicator = () => {
    const hasPendingTags = serializeTagMap(currentAlbumTagMap) !== serializeTagMap(savedAlbumTagMap);
    const tagToggle = document.getElementById('dev-tag-toggle') as HTMLButtonElement | null;
    if (!tagToggle) return;
    tagToggle.classList.toggle('has-pending', hasPendingTags);
    tagToggle.classList.toggle('is-active', activeTagMode);
    tagToggle.title = hasPendingTags
        ? 'Finish editing to save tag changes'
        : activeTagMode ? 'Finish editing tags' : 'Edit tags';
    tagToggle.setAttribute('aria-label', tagToggle.title);
};

const updateAllTagPendingIndicators = () => {
    updateGlobalTagPendingIndicator();
};

const hasPendingBlockChanges = () => (
    pendingCaptionChanges.size > 0
    || pendingTextChanges.size > 0
    || pendingBlockMarginChanges.size > 0
    || pendingBlockTypeChanges.size > 0
    || pendingLayoutChange !== null
);

const hasPendingTagChanges = () => (
    serializeTagMap(currentAlbumTagMap) !== serializeTagMap(savedAlbumTagMap)
);

const hasPendingChanges = () => hasPendingTagChanges() || hasPendingBlockChanges();

type AlbumEditMode = 'blocks' | 'tags';
const canStartEditMode = (_target: AlbumEditMode) => !pendingSaveInProgress;

const handlePendingBeforeUnload = (event: BeforeUnloadEvent) => {
    if (pendingSaveInProgress || !hasPendingChanges()) return;
    event.preventDefault();
    (event as any).returnValue = '';
};

const handlePendingBeforePreparation = (event: Event) => {
    if (pendingSaveInProgress || !hasPendingChanges()) return;
    // Let the browser's native beforeunload confirmation own the
    // decision by forcing Astro's client transition to fall back.
    event.preventDefault();
};

window.addEventListener('beforeunload', handlePendingBeforeUnload);
document.addEventListener('astro:before-preparation', handlePendingBeforePreparation);

const updateSaveButtonState = (isSaving = false) => {
    const saveBtn = document.getElementById('dev-save-btn') as HTMLButtonElement | null;
    if (!saveBtn) return;

    const hasPendingEdits = hasPendingChanges();
    saveBtn.disabled = isSaving;
    saveBtn.classList.toggle('has-pending', hasPendingEdits);
    saveBtn.classList.toggle('active', activeBlockEditMode && !hasPendingEdits);
    saveBtn.setAttribute('aria-pressed', String(activeBlockEditMode));
    saveBtn.title = isSaving
        ? 'Saving pending changes...'
        : hasPendingEdits
            ? 'Finish editing and save changes'
            : activeBlockEditMode ? 'Finish editing' : 'Edit blocks';
    saveBtn.setAttribute('aria-label', saveBtn.title);
    updateGlobalTagPendingIndicator();
    updateEditModeAvailability(isSaving);
};

const rememberMountainName = (name: string, region?: MountainRegion) => {
    if (!name.trim()) return;
    const isNewMountain = !mountainCache.some((mountain) => mountain.name === name);
    if (isNewMountain) {
        if (!region) return;
        mountainCache = [...mountainCache, {
            name,
            elevation: null,
            description: '',
            region,
        }]
            .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'));
    }
    if (isNewMountain && region) pendingMountainRegions[name] = region;
};

const readAlbumTagStateFromDom = () => {
    const nextTagMap: Record<string, { name: string; x: number; y: number }[]> = {};

    document.querySelectorAll('.photo-wrapper[data-item-key]').forEach((wrapper) => {
        const photoId = (wrapper as HTMLElement).dataset.itemKey;
        if (!photoId) return;

        const tags = Array.from(wrapper.querySelectorAll('.tag-name')).map((tagName) => {
            const el = tagName as HTMLElement;
            return {
                name: el.dataset.name || '',
                x: parseFloat(el.dataset.x || '0'),
                y: parseFloat(el.dataset.y || '0'),
            };
        }).filter((tag) => tag.name);

        if (tags.length > 0) {
            nextTagMap[getTagKeyFromPhotoId(photoId)] = tags;
        }
    });

    return normalizeTagMap(nextTagMap);
};

const syncAlbumTagStateFromDom = () => {
    savedAlbumTagMap = readAlbumTagStateFromDom();
    currentAlbumTagMap = normalizeTagMap(savedAlbumTagMap);
    updateSaveButtonState();
};

const renderTagOverlay = (wrapper: HTMLElement) => {
    const photoId = getPhotoIdFromWrapper(wrapper);
    if (!photoId) return;

    wrapper.querySelector('.tags-overlay')?.remove();

    const tags = currentAlbumTagMap[getTagKeyFromPhotoId(photoId)] || [];
    const sliceIndex = Number.parseInt(wrapper.dataset.panoramaSliceIndex || '', 10);
    const sliceCount = Number.parseInt(wrapper.dataset.panoramaSliceCount || '', 10);
    const isPanoramaSlice = Number.isInteger(sliceIndex)
        && Number.isInteger(sliceCount)
        && sliceCount > 1
        && sliceIndex >= 0
        && sliceIndex < sliceCount;
    const displayTags = tags.flatMap((tag) => {
        if (!isPanoramaSlice) return [{ ...tag, displayX: tag.x }];
        const owner = Math.min(
            sliceCount - 1,
            Math.max(0, Math.floor((tag.x / 100) * sliceCount)),
        );
        if (owner !== sliceIndex) return [];
        return [{
            ...tag,
            displayX: Math.min(100, Math.max(0, tag.x * sliceCount - sliceIndex * 100)),
        }];
    });
    if (tags.length > 0) wrapper.dataset.hasTags = 'true';
    else delete wrapper.dataset.hasTags;
    if (displayTags.length === 0) return;

    const overlay = document.createElement('div');
    overlay.className = 'tags-overlay';
    overlay.innerHTML = displayTags.map((tag) => `
        <div class="tag-marker" style="left: ${tag.displayX}%; top: ${tag.y}%;">
            <div class="tag-content">
                <div class="tag-line"></div>
                <a href="/yama/tags/${encodeURIComponent(tag.name)}" class="tag-link" data-mountain-tag-link>
                    <span class="tag-name" data-name="${escapeHtml(tag.name)}" data-x="${tag.x}" data-y="${tag.y}">${escapeHtml(tag.name)}</span>
                </a>
            </div>
        </div>
    `).join('');
    wrapper.appendChild(overlay);
};

const renderTagOverlaysForPhoto = (photoId: string) => {
    const escapedPhotoId = CSS.escape(photoId);
    document.querySelectorAll(
        `.photo-wrapper[data-item-key="${escapedPhotoId}"], .photo-wrapper[data-panorama-source-item-key="${escapedPhotoId}"]`,
    ).forEach((wrapper) => {
        renderTagOverlay(wrapper as HTMLElement);
    });
    initTagEditButtons();
    updateAllTagPendingIndicators();
    updateSaveButtonState();
};

const savePendingTagChanges = async (albumSlug: string) => {
    if (serializeTagMap(currentAlbumTagMap) === serializeTagMap(savedAlbumTagMap)) {
        return true;
    }

    try {
        const response = await fetch('/api/save-tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                albumSlug,
                tagsMap: currentAlbumTagMap,
                newMountainRegions: pendingMountainRegions,
            }),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || 'Save failed');
        }

        savedAlbumTagMap = normalizeTagMap(currentAlbumTagMap);
        collectTagNames(savedAlbumTagMap).forEach((name) => {
            rememberMountainName(name, pendingMountainRegions[name]);
            delete pendingMountainRegions[name];
        });
        updateAllTagPendingIndicators();
        return true;
    } catch (error: any) {
        showToast(`❌ Save failed: ${error?.message || 'Unknown error'}`);
        return false;
    }
};

const savePendingPageChanges = async (albumSlug: string) => {
    const captionChanges = [...pendingCaptionChanges.entries()];
    const textChanges = [...pendingTextChanges.entries()];
    const marginChanges = [...pendingBlockMarginChanges.entries()];
    const typeChanges = [...pendingBlockTypeChanges.entries()];
    const structureChange = pendingLayoutChange?.albumSlug === albumSlug
        ? pendingLayoutChange
        : null;
    if (captionChanges.length === 0
        && textChanges.length === 0
        && marginChanges.length === 0
        && typeChanges.length === 0
        && !structureChange) return true;

    try {
        let structure: any;
        if (structureChange) {
            structure = {
                blocks: JSON.parse(JSON.stringify(structureChange.draft.blocks)),
                metadata: { ...structureChange.draft.metadata },
            };
        } else {
            const structureResponse = await fetch(`/api/get-page-structure?albumSlug=${encodeURIComponent(albumSlug)}`);
            if (!structureResponse.ok) throw new Error('Failed to load page structure');
            structure = await structureResponse.json();
        }

        const findBlock = (
            sourceType: string,
            photoNames: string[],
            blockIndex: number,
            originalText?: string,
            blockKey?: string,
        ) => {
            if (blockKey) {
                const keyedIndex = structure.blocks.findIndex((candidate: any) => candidate.__devKey === blockKey);
                if (keyedIndex >= 0) return keyedIndex;
            }
            const indexedCandidate = structure.blocks[blockIndex];
            if (sourceType === 'Text') {
                if (indexedCandidate?.type === 'Text'
                    && (originalText === undefined || String(indexedCandidate.text || '').trim() === originalText)) {
                    return blockIndex;
                }
                return originalText !== undefined
                    ? structure.blocks.findIndex((candidate: any) =>
                        candidate.type === 'Text' && String(candidate.text || '').trim() === originalText)
                    : -1;
            }
            if (indexedCandidate && indexedCandidate.type !== 'Text'
                && indexedCandidate.photos?.length === photoNames.length
                && indexedCandidate.photos.every((photo: any, index: number) => photo.itemKey === photoNames[index])) {
                return blockIndex;
            }
            return structure.blocks.findIndex((candidate: any) =>
                candidate.type !== 'Text'
                && candidate.photos?.length === photoNames.length
                && candidate.photos.every((photo: any, index: number) => photo.itemKey === photoNames[index]),
            );
        };
        for (const [, change] of captionChanges) {
            const targetIndex = findBlock(change.sourceType, change.photoNames, change.blockIndex);
            if (targetIndex < 0) {
                if (structureChange) continue;
                throw new Error('Could not identify a caption block');
            }

            const props = { ...(structure.blocks[targetIndex].props || {}) };
            if (change.caption) {
                props.caption = change.caption;
                props.captionPosition = change.captionPosition;
            } else {
                delete props.caption;
                delete props.captionPosition;
            }
            structure.blocks[targetIndex].props = props;
            if (change.caption) applyDefaultCaptionBoundaryMargin(structure.blocks, targetIndex);
        }
        for (const [, change] of textChanges) {
            if (change.deleted) continue;
            const targetIndex = findBlock(change.sourceType, [], change.blockIndex, change.originalText, change.blockKey);
            if (targetIndex < 0) {
                if (structureChange) continue;
                throw new Error('Could not identify a text block');
            }
            const target = structure.blocks[targetIndex];
            target.text = change.text;
            target.props = { ...(target.props || {}) };
            if (change.align === 'center') delete target.props.align;
            else target.props.align = change.align;
            if (change.textType === 'caption') delete target.props.size;
            else target.props.size = change.textType;
        }
        for (const [, change] of marginChanges) {
            const targetIndex = findBlock(change.sourceType, change.photoNames, change.blockIndex, change.originalText, change.blockKey);
            if (targetIndex < 0) {
                if (structureChange) continue;
                throw new Error('Could not identify a margin block');
            }
            const props = { ...(structure.blocks[targetIndex].props || {}) };
            if (change.blockMargin) props.blockMargin = change.blockMargin;
            else delete props.blockMargin;
            if (change.sourceType === 'Text') {
                delete props.mt;
                delete props.mb;
            }
            structure.blocks[targetIndex].props = props;
        }
        for (const [, change] of typeChanges) {
            const targetIndex = findBlock(change.sourceType, change.photoNames, change.blockIndex);
            if (targetIndex < 0) {
                if (structureChange) continue;
                throw new Error('Could not identify a media block');
            }
            const target = structure.blocks[targetIndex];
            target.type = change.targetType;
            target.props = { ...(target.props || {}) };
            if (change.targetType !== 'PhotoPanorama') {
                delete target.props.initialView;
                delete target.props.panoramaSlices;
            }
        }
        textChanges
            .filter(([, change]) => change.deleted)
            .sort(([, left], [, right]) => right.blockIndex - left.blockIndex)
            .forEach(([, change]) => {
                const targetIndex = findBlock(change.sourceType, [], change.blockIndex, change.originalText, change.blockKey);
                if (targetIndex < 0) {
                    if (structureChange) return;
                    throw new Error('Could not identify a text block');
                }
                structure.blocks.splice(targetIndex, 1);
            });
        structure.blocks = structure.blocks.filter((block: any) =>
            block.type !== 'Text' || String(block.text || '').trim(),
        );
        const blocksToPersist = structure.blocks.map((block: any) => {
            const { __devKey: _devKey, ...persistedBlock } = block;
            return persistedBlock;
        });

        const form = new FormData();
        form.set('albumSlug', albumSlug);
        form.set('draft', JSON.stringify({
            blocks: blocksToPersist,
            metadata: {
                title: structure.metadata.title,
                info: structure.metadata.info || undefined,
                gap: structure.metadata.gap || undefined,
            },
            removeLocal: structureChange?.draft.removeLocal || [],
        }));
        structureChange?.imports.forEach((file) => form.append('photos', file, file.name));
        const saveResponse = await fetch('/api/save-page-manager', {
            method: 'POST',
            body: form,
        });
        if (!saveResponse.ok) {
            const result = await saveResponse.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to save captions');
        }
        captionChanges.forEach(([key, change]) => {
            if (pendingCaptionChanges.get(key) === change) pendingCaptionChanges.delete(key);
        });
        textChanges.forEach(([key, change]) => {
            if (pendingTextChanges.get(key) === change) pendingTextChanges.delete(key);
        });
        marginChanges.forEach(([key, change]) => {
            if (pendingBlockMarginChanges.get(key) === change) pendingBlockMarginChanges.delete(key);
        });
        typeChanges.forEach(([key, change]) => {
            if (pendingBlockTypeChanges.get(key) === change) pendingBlockTypeChanges.delete(key);
        });
        if (pendingLayoutChange === structureChange) pendingLayoutChange = null;
        return true;
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to save block changes'}`);
        return false;
    }
};

const savePendingChanges = async () => {
    const albumSlug = getAlbumSlug();
    if (!albumSlug) return showToast('❌ Cannot identify album');
    const hasPendingBlockChanges = pendingCaptionChanges.size > 0
        || pendingTextChanges.size > 0
        || pendingBlockMarginChanges.size > 0
        || pendingBlockTypeChanges.size > 0
        || pendingLayoutChange !== null;
    const hasPendingTags = serializeTagMap(currentAlbumTagMap) !== serializeTagMap(savedAlbumTagMap);
    if (!hasPendingBlockChanges && !hasPendingTags) return showToast('ℹ️ No pending changes');

    pendingSaveInProgress = true;
    updateSaveButtonState(true);
    const tagsSaved = await savePendingTagChanges(albumSlug);
    if (tagsSaved && hasPendingBlockChanges) {
        // The dev server can reload on the manifest update before the response returns.
        sessionStorage.setItem('dev-caption-save-scroll-y', String(window.scrollY));
    }
    const blocksSaved = tagsSaved && await savePendingPageChanges(albumSlug);
    pendingSaveInProgress = false;
    updateSaveButtonState();
    if (!tagsSaved || !blocksSaved) {
        if (!blocksSaved) sessionStorage.removeItem('dev-caption-save-scroll-y');
        return;
    }

    showToast('✅ Pending changes saved');
    if (hasPendingBlockChanges) {
        window.setTimeout(() => window.location.reload(), 500);
    } else {
        setGlobalTagMode(false);
        setLayoutEditMode(false);
    }
};

// Tag Editing Dialog
function createTagDialog() {
    let existing = document.getElementById("dev-tag-dialog") as HTMLDialogElement;
    if (existing) return existing;

    const dialog = document.createElement("dialog");
    dialog.id = "dev-tag-dialog";
    dialog.innerHTML = `
        <form method="dialog" id="dev-tag-form">
            <h3 id="dev-tag-dialog-title" style="margin:0 0 0.75rem;font-size:0.95rem;font-family:sans-serif;color:#111">
                Add Tag Point
            </h3>
            <p id="dev-tag-coords" style="font-size:0.75rem;color:#555;margin:0 0 0.5rem;font-family:monospace"></p>
            <label id="dev-tag-region-field" style="display:block;margin-top:0.65rem;font-size:0.75rem;color:#555;font-family:sans-serif">
                Region
                <select id="dev-tag-region" style="display:block;width:100%;margin-top:0.3rem;padding:0.4rem 0.5rem;border:1px solid #ccc;border-radius:4px;background:#fff;font-size:0.85rem;box-sizing:border-box">
                    <option value="">Choose a region</option>
                </select>
            </label>
            <input
                id="dev-tag-input"
                list="dev-tag-datalist"
                placeholder="Choose a region first"
                autocomplete="off"
                style="width:100%;margin-top:0.65rem;padding:0.4rem 0.5rem;border:1px solid #ccc;border-radius:4px;font-size:0.9rem;box-sizing:border-box"
            />
            <datalist id="dev-tag-datalist"></datalist>
            <div style="display:flex;gap:0.5rem;margin-top:0.75rem;justify-content:flex-end">
                <button type="button" id="dev-tag-delete" class="hidden" title="Delete"
                    style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:none;border-radius:4px;background:#ef4444;color:#fff;cursor:pointer;">
                    ${ICONS.trash}
                </button>
                <button type="button" id="dev-tag-copy" class="hidden" title="Copy"
                    style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:none;border-radius:4px;background:#10b981;color:#fff;cursor:pointer;">
                    ${ICONS.copy}
                </button>
                <button type="button" id="dev-tag-paste" class="hidden" title="Paste"
                    style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:none;border-radius:4px;background:#f59e0b;color:#fff;cursor:pointer;">
                    ${ICONS.clipboard}
                </button>
                <button type="button" id="dev-tag-cancel" title="Cancel"
                    style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;color:#333;">
                    ${ICONS.close}
                </button>
                <button type="submit" id="dev-tag-submit" title="Confirm"
                    style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:none;border-radius:4px;background:#2563eb;color:#fff;cursor:pointer;">
                    ${ICONS.check}
                </button>
            </div>
        </form>
    `;
    dialog.style.cssText = `
        border:none;border-radius:8px;padding:1rem 1.25rem;
        box-shadow:0 8px 30px rgba(0,0,0,0.18);max-width:320px;width:90vw;
        position:fixed;
    `;
    document.body.appendChild(dialog);
    return dialog;
}

function showTagDialog(options: {
    title: string; photoId: string; x: number; y: number; initialName?: string; showDelete?: boolean
}): Promise<{ action: 'save' | 'delete' | 'cancel', name?: string, region?: MountainRegion }> {
    return new Promise(async (resolve) => {
        const mountains = await fetchMountains();
        const dialog = createTagDialog();
        const form = dialog.querySelector("#dev-tag-form") as HTMLFormElement;
        const titleEl = dialog.querySelector("#dev-tag-dialog-title") as HTMLElement;
        const input = dialog.querySelector("#dev-tag-input") as HTMLInputElement;
        const datalist = dialog.querySelector("#dev-tag-datalist") as HTMLDataListElement;
        const regionSelect = dialog.querySelector("#dev-tag-region") as HTMLSelectElement;
        const coordsEl = dialog.querySelector("#dev-tag-coords") as HTMLParagraphElement;
        const cancelBtn = dialog.querySelector("#dev-tag-cancel") as HTMLButtonElement;
        const deleteBtn = dialog.querySelector("#dev-tag-delete") as HTMLButtonElement;
        const copyBtn = dialog.querySelector("#dev-tag-copy") as HTMLButtonElement;
        const pasteBtn = dialog.querySelector("#dev-tag-paste") as HTMLButtonElement;

        titleEl.textContent = options.title;
        coordsEl.textContent = `${options.photoId.split('/').pop()}  x:${options.x.toFixed(1)}%  y:${options.y.toFixed(1)}%`;
        input.value = options.initialName || "";
        regionSelect.innerHTML = [
            '<option value="">Choose a region</option>',
            ...mountainRegions.map(
                (region) =>
                    `<option value="${escapeHtml(region.id)}">${escapeHtml(region.label)}</option>`,
            ),
        ].join('');

        const initialMountain = mountains.find(
            (mountain) => mountain.name === input.value.trim(),
        );
        const savedRegion = localStorage.getItem('devTagRegion');
        regionSelect.value = initialMountain?.region && mountainRegions.some(
            (region) => region.id === initialMountain.region,
        )
            ? initialMountain.region
            : savedRegion && mountainRegions.some((region) => region.id === savedRegion)
                ? savedRegion
                : '';

        const renderRegionMountains = () => {
            const region = regionSelect.value;
            const regionMountains = mountains.filter(
                (mountain) => mountain.region === region,
            );
            datalist.innerHTML = regionMountains
                .map((mountain) => `<option value="${escapeHtml(mountain.name)}"></option>`)
                .join("");
            input.disabled = !region;
            input.placeholder = region
                ? 'Mountain name (choose or enter a new name)'
                : 'Choose a region first';
        };
        renderRegionMountains();

        if (options.showDelete) {
            deleteBtn.style.display = 'flex';
            copyBtn.style.display = 'flex';
        } else {
            deleteBtn.style.display = 'none';
            copyBtn.style.display = 'none';
        }

        const copiedTag = localStorage.getItem('devCopiedTagName');
        if (copiedTag && !options.initialName) {
            pasteBtn.style.display = 'flex';
            pasteBtn.title = `Paste: ${copiedTag}`;
        } else {
            pasteBtn.style.display = 'none';
        }

        const cleanup = (result: { action: 'save' | 'delete' | 'cancel', name?: string, region?: MountainRegion }) => {
            form.removeEventListener("submit", submitHandler);
            cancelBtn.removeEventListener("click", cancelHandler);
            deleteBtn.removeEventListener("click", deleteHandler);
            copyBtn.removeEventListener("click", copyHandler);
            pasteBtn.removeEventListener("click", pasteHandler);
            regionSelect.removeEventListener("change", regionChangeHandler);
            resolve(result);
        };

        const submitHandler = (e: Event) => {
            e.preventDefault();
            const name = input.value.trim();
            const existing = mountains.some((mountain) => mountain.name === name);
            const region = regionSelect.value as MountainRegion | '';
            if (!region) {
                regionSelect.focus();
                return;
            }
            const existingMountain = mountains.find(
                (mountain) => mountain.name === name,
            );
            if (existingMountain && existingMountain.region !== region) {
                const existingRegionLabel = mountainRegions.find(
                    (candidate) => candidate.id === existingMountain.region,
                )?.label ?? existingMountain.region;
                showToast(`❌ "${name}" belongs to the ${existingRegionLabel} region`);
                input.focus();
                return;
            }
            dialog.close();
            cleanup({
                action: 'save',
                name,
                ...(!existing && region ? { region } : {}),
            });
        };

        const cancelHandler = () => {
            dialog.close();
            cleanup({ action: 'cancel' });
        };

        const deleteHandler = () => {
            dialog.close();
            cleanup({ action: 'delete' });
        };

        const copyHandler = () => {
            const tagName = input.value.trim();
            if (tagName) {
                setCopiedTagName(tagName);
                showToast(`📄 Copied tag: ${tagName}`);
            }
            dialog.close();
            cleanup({ action: 'cancel' });
        };

        const pasteHandler = () => {
            const copiedTag = localStorage.getItem('devCopiedTagName');
            if (copiedTag) {
                const copiedMountain = mountains.find(
                    (mountain) => mountain.name === copiedTag,
                );
                if (copiedMountain && mountainRegions.some(
                    (region) => region.id === copiedMountain.region,
                )) {
                    regionSelect.value = copiedMountain.region;
                    localStorage.setItem('devTagRegion', copiedMountain.region);
                    renderRegionMountains();
                }
                input.value = copiedTag;
                showToast(`📋 Pasted "${copiedTag}"`);
                pasteBtn.style.display = 'none';
            }
        };

        const regionChangeHandler = () => {
            const currentName = input.value.trim();
            const currentMountain = mountains.find(
                (mountain) => mountain.name === currentName,
            );
            if (
                currentMountain &&
                currentMountain.region !== regionSelect.value
            ) {
                input.value = '';
            }
            if (regionSelect.value) {
                localStorage.setItem('devTagRegion', regionSelect.value);
            }
            renderRegionMountains();
            input.focus();
        };

        form.addEventListener("submit", submitHandler);
        regionSelect.addEventListener("change", regionChangeHandler);
        cancelBtn.addEventListener("click", cancelHandler);
        deleteBtn.addEventListener("click", deleteHandler);
        copyBtn.addEventListener("click", copyHandler);
        pasteBtn.addEventListener("click", pasteHandler);

        dialog.showModal();
        input.focus();
    });
}

// Page Manager (Tree View)
const appendPendingRichText = (container: HTMLElement, value: string) => {
    const richText = document.createElement('span');
    richText.className = 'rich-text';
    parseRichText(value).forEach((token) => {
        if (token.type === 'break') {
            richText.appendChild(document.createElement('br'));
            return;
        }
        if (token.type === 'text') {
            richText.appendChild(document.createTextNode(token.value));
            return;
        }
        if (token.type === 'strong' || token.type === 'emphasis') {
            const emphasis = document.createElement(token.type === 'strong' ? 'strong' : 'em');
            emphasis.textContent = token.value;
            richText.appendChild(emphasis);
            return;
        }
        const link = document.createElement('a');
        link.className = 'rich-text__link';
        link.href = token.href;
        link.textContent = token.label;
        if (token.external) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
        richText.appendChild(link);
    });
    container.appendChild(richText);
};

const renderPendingPageStructure = (
    albumSlug: string,
    draft: PageStructureDraft,
    imports: File[],
) => {
    const albumContent = document.querySelector<HTMLElement>('.album-content');
    if (!albumContent) return;

    const gridToggle = document.getElementById('toggle-photo-grid') as HTMLButtonElement | null;
    if (albumContent.dataset.gridActive === 'true') gridToggle?.click();

    const basename = (value: string) => value.replace(/^\/+/, '').split('/').pop() || value;
    if (!pendingStructurePhotoNodes) {
        pendingStructurePhotoNodes = new Map(
            Array.from(albumContent.querySelectorAll<HTMLElement>('.photo-container'))
                .flatMap((photo) => {
                    const itemKey = photo.querySelector<HTMLElement>('.photo-wrapper[data-item-key]')?.dataset.itemKey;
                    if (!itemKey) return [];
                    const cleanPhoto = photo.cloneNode(true) as HTMLElement;
                    cleanPhoto.querySelectorAll('.dev-tag-edit-btn').forEach((button) => button.remove());
                    delete cleanPhoto.dataset.slideIndex;
                    cleanPhoto.removeAttribute('data-active');
                    return [[basename(itemKey), cleanPhoto] as const];
                }),
        );
    }

    const importedByName = new Map(imports.map((file) => [file.name, file]));
    pendingStructureObjectUrls.forEach((url, file) => {
        if (imports.includes(file)) return;
        URL.revokeObjectURL(url);
        pendingStructureObjectUrls.delete(file);
        const photo = pendingStructurePhotoNodes?.get(file.name);
        if (photo?.classList.contains('dev-pending-photo-container')) {
            pendingStructurePhotoNodes?.delete(file.name);
        }
    });

    const getPhotoNode = (itemKey: string) => {
        const name = basename(itemKey);
        const existing = pendingStructurePhotoNodes?.get(name);
        if (existing) return existing;

        const file = importedByName.get(name);
        if (!file) return null;
        let objectUrl = pendingStructureObjectUrls.get(file);
        if (!objectUrl) {
            objectUrl = URL.createObjectURL(file);
            pendingStructureObjectUrls.set(file, objectUrl);
        }

        const photo = document.createElement('div');
        photo.className = 'photo-container dev-pending-photo-container';
        const wrapper = document.createElement('div');
        wrapper.className = 'photo-wrapper';
        wrapper.dataset.itemKey = `${albumSlug}/${name}`;
        wrapper.dataset.dev = 'true';
        const link = document.createElement('a');
        link.href = objectUrl;
        link.target = '_blank';
        link.className = 'pswp-link block';
        link.dataset.pswpSrc = objectUrl;
        link.dataset.photoLightboxLink = '';
        const image = document.createElement('img');
        image.src = objectUrl;
        image.alt = '';
        image.className = 'photo-img';
        image.addEventListener('load', () => {
            link.dataset.pswpWidth = String(image.naturalWidth);
            link.dataset.pswpHeight = String(image.naturalHeight);
        }, { once: true });
        link.appendChild(image);
        wrapper.appendChild(link);
        photo.appendChild(wrapper);
        pendingStructurePhotoNodes?.set(name, photo);
        return photo;
    };

    const createCaption = (caption: string, position: string) => {
        const captionNode = document.createElement('div');
        const vertical = position.includes('top') ? 'top' : 'bottom';
        const align = position.includes('left') ? 'left' : position.includes('right') ? 'right' : 'center';
        captionNode.className = `photo-caption ${vertical}`;
        captionNode.style.textAlign = align;
        appendPendingRichText(captionNode, caption);
        return captionNode;
    };

    const fragment = document.createDocumentFragment();
    draft.blocks.forEach((block: any) => {
        const props = block.props || {};
        if (block.type === 'Text') {
            const align = props.align || 'center';
            const size = props.size || 'caption';
            const text = document.createElement('div');
            text.className = `text-block text-block--${size} dev-page-structure-preview`;
            text.dataset.devBlock = 'text';
            text.dataset.devBlockKey = block.__devKey || '';
            text.dataset.devTextAlign = align;
            text.dataset.devTextType = size;
            if (props.blockMargin || props.mb) text.dataset.devBlockMargin = props.blockMargin || props.mb;
            text.style.marginBottom = props.blockMargin || props.mb || '0.5rem';
            text.style.textAlign = align;
            const content = document.createElement('div');
            content.className = 'text-block__content';
            appendPendingRichText(content, String(block.text || ''));
            text.appendChild(content);
            fragment.appendChild(text);
            return;
        }

        const isPanorama = block.type === 'PhotoPanorama';
        const isCarousel = block.type === 'PhotoCarousel';
        const panoramaSliceCount = isPanorama && block.photos?.length === 1
            ? Math.min(24, Math.max(1, Math.trunc(Number(props.panoramaSlices) || 1)))
            : 1;
        const media = document.createElement(isCarousel || isPanorama ? 'section' : 'div');
        media.className = `${isCarousel ? 'carousel-section group' : isPanorama ? 'photo-panorama-section group' : 'row-wrapper'} dev-page-structure-preview`;
        media.dataset.devBlock = isCarousel || isPanorama ? 'carousel' : 'row';
        if (isPanorama) media.dataset.devPanorama = 'true';
        if (isPanorama) media.dataset.panoramaSlices = String(panoramaSliceCount);
        const peekPercent = isCarousel ? Math.min(90, Math.max(0, Math.trunc(Number(props.peekPercent) || 0))) : 0;
        if (isCarousel) media.dataset.peekPercent = String(peekPercent);
        media.dataset.devBlockKey = block.__devKey || '';
        const caption = String(props.caption || '');
        const captionPosition = String(props.captionPosition || 'center bottom');
        if (caption) media.dataset.devCaption = caption;
        media.dataset.devCaptionPos = captionPosition;
        if (props.blockMargin || props.mb) media.dataset.devBlockMargin = props.blockMargin || props.mb;

        if (isCarousel) {
            media.dataset.carousel = '';
            media.dataset.initialSlide = String(props.initialSlide || 0);
            const topMargin = props.mt || (caption && captionPosition.includes('top') ? props.captionMargin : '');
            const bottomMargin = props.mb || props.blockMargin || (caption && captionPosition.includes('bottom') ? props.captionMargin : '');
            if (topMargin) media.style.setProperty('margin-top', topMargin, 'important');
            if (bottomMargin) media.style.setProperty('margin-bottom', bottomMargin, 'important');
        } else {
            if (isPanorama) {
                media.dataset.photoPanorama = '';
                media.dataset.initialView = props.initialView === 'panorama' ? 'panorama' : 'carousel';
                media.dataset.view = media.dataset.initialView;
                media.dataset.initialSlide = String(props.initialSlide || 0);
            }
            const topMargin = props.mt || (caption && captionPosition.includes('top') ? props.captionMargin : '');
            const bottomMargin = props.mb || props.blockMargin || (caption && captionPosition.includes('bottom') ? props.captionMargin : '');
            if (topMargin) media.style.setProperty('margin-top', topMargin, 'important');
            if (bottomMargin) media.style.setProperty('margin-bottom', bottomMargin, 'important');
        }

        if (caption && captionPosition.includes('top')) media.appendChild(createCaption(caption, captionPosition));
        const track = document.createElement('div');
        track.className = isCarousel ? 'carousel-track' : isPanorama ? 'photo-panorama-track' : 'photo-row';
        if (!isCarousel && !isPanorama) track.dataset.photoRow = '';
        if (isCarousel) track.style.setProperty('--slide-width', `${100 - peekPercent}%`);
        const photos = block.photos || [];
        const cells: RowCell[] = isCarousel || isPanorama
            ? photos.map((_: any, index: number) => ({ start: index, end: index + 1 }) as RowCell)
            : rowCells(photos);
        cells.forEach((cell) => {
            const parent = cell.column ? document.createElement('div') : track;
            if (cell.column) {
                parent.className = 'photo-column';
                parent.dataset.photoColumn = '';
                track.appendChild(parent);
            }
            photos.slice(cell.start, cell.end).forEach((photo: any) => {
                const photoNode = getPhotoNode(photo.itemKey);
                if (!photoNode) return;
                photoNode.style.removeProperty('flex');
                photoNode.removeAttribute('data-active');
                parent.appendChild(photoNode);
            });
            if (cell.column && !parent.childElementCount) parent.remove();
        });
        const panoramaSliceSlides: HTMLElement[] = [];
        if (panoramaSliceCount > 1 && track.children.length === 1) {
            const sourceSlide = track.firstElementChild as HTMLElement;
            sourceSlide.classList.add('photo-panorama-single-source');
            media.dataset.singlePhotoSliced = 'true';
            for (let index = 0; index < panoramaSliceCount; index += 1) {
                const slice = sourceSlide.cloneNode(true) as HTMLElement;
                slice.classList.remove('photo-panorama-single-source');
                slice.classList.add('photo-panorama-slice');
                slice.dataset.panoramaGeneratedSlice = 'true';
                slice.style.setProperty('--panorama-slice-width', `${panoramaSliceCount * 100}%`);
                slice.style.setProperty('--panorama-slice-offset', `${(-index * 100) / panoramaSliceCount}%`);
                slice.style.setProperty('--panorama-slice-clip-start', `${(index * 100) / panoramaSliceCount}%`);
                slice.style.setProperty('--panorama-slice-clip-end', `${((panoramaSliceCount - index - 1) * 100) / panoramaSliceCount}%`);
                slice.style.setProperty(
                    '--panorama-slice-mobile-clip-start',
                    index === 0 ? '0%' : `calc(${(index * 100) / panoramaSliceCount}% - 1px)`,
                );
                slice.style.setProperty(
                    '--panorama-slice-mobile-clip-end',
                    index === panoramaSliceCount - 1
                        ? '0%'
                        : `calc(${((panoramaSliceCount - index - 1) * 100) / panoramaSliceCount}% - 1px)`,
                );
                const sourceWrapper = sourceSlide.querySelector<HTMLElement>('.photo-wrapper[data-item-key]');
                const sliceWrapper = slice.querySelector<HTMLElement>('.photo-wrapper');
                if (sliceWrapper && sourceWrapper?.dataset.itemKey) {
                    sliceWrapper.dataset.panoramaSourceItemKey = sourceWrapper.dataset.itemKey;
                    sliceWrapper.dataset.panoramaSliceIndex = String(index);
                    sliceWrapper.dataset.panoramaSliceCount = String(panoramaSliceCount);
                }
                slice.querySelectorAll<HTMLElement>('[data-item-key]').forEach((node) => node.removeAttribute('data-item-key'));
                slice.querySelectorAll<HTMLElement>('.tag-marker').forEach((marker) => {
                    const tagName = marker.querySelector<HTMLElement>('.tag-name');
                    const x = Number.parseFloat(tagName?.dataset.x || marker.style.left || '0');
                    const owner = Math.min(
                        panoramaSliceCount - 1,
                        Math.max(0, Math.floor((x / 100) * panoramaSliceCount)),
                    );
                    if (owner !== index) {
                        marker.remove();
                        return;
                    }
                    marker.style.left = `${Math.min(100, Math.max(0, x * panoramaSliceCount - index * 100))}%`;
                });
                slice.querySelector<HTMLElement>('.tags-overlay:empty')?.remove();
                slice.querySelector('[data-photo-lightbox-link]')?.removeAttribute('data-photo-lightbox-link');
                slice.querySelector(':scope > .photo-caption--photo')?.remove();
                track.appendChild(slice);
                panoramaSliceSlides.push(slice);
            }
        }
        media.appendChild(track);

        if (isCarousel || isPanorama) {
            const dots = document.createElement('div');
            dots.className = isCarousel ? 'carousel-dots' : 'photo-panorama-dots';
            const slides = panoramaSliceSlides.length > 0
                ? panoramaSliceSlides
                : Array.from(track.children) as HTMLElement[];
            const initialIndex = Math.min(Number(props.initialSlide) || 0, Math.max(0, slides.length - 1));
            slides.forEach((slide, index) => {
                slide.toggleAttribute('data-active', index === initialIndex);
                if (isPanorama) {
                    const image = slide.querySelector<HTMLImageElement>('img');
                    const applyRatio = () => {
                        if (!image?.naturalWidth || !image.naturalHeight) return;
                        const ratio = (image.naturalWidth / image.naturalHeight) * 100;
                        slide.style.setProperty(
                            '--panorama-grow',
                            String(panoramaSliceSlides.length > 0 ? ratio / panoramaSliceCount : ratio),
                        );
                    };
                    if (image?.complete) applyRatio();
                    else image?.addEventListener('load', applyRatio, { once: true });
                }
                if (slides.length < 2) return;
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = `${isCarousel ? 'carousel-dot' : 'photo-panorama-dot'}${index === initialIndex ? ' active' : ''}`;
                dot.setAttribute('aria-label', `Go to slide ${index + 1}`);
                dot.addEventListener('click', () => {
                    slides.forEach((candidate) => candidate.removeAttribute('data-active'));
                    dots.querySelectorAll('.carousel-dot, .photo-panorama-dot').forEach((candidate) => candidate.classList.remove('active'));
                    slide.setAttribute('data-active', '');
                    dot.classList.add('active');
                    if (isPanorama) media.dataset.view = 'carousel';
                    track.scrollTo({
                        left: isPanorama
                            ? slide.offsetLeft - track.offsetLeft
                            : slide.offsetLeft - track.offsetLeft - (track.clientWidth - slide.clientWidth) / 2,
                        behavior: 'smooth',
                    });
                });
                dots.appendChild(dot);
            });
            if (isPanorama) {
                const controls = document.createElement('div');
                controls.className = 'photo-panorama-controls';
                controls.appendChild(dots);
                const viewToggle = document.createElement('button');
                viewToggle.type = 'button';
                viewToggle.className = 'photo-panorama-view-toggle';
                viewToggle.setAttribute('aria-label', 'Toggle panorama view');
                viewToggle.innerHTML = '<span aria-hidden="true">P</span>';
                viewToggle.addEventListener('click', () => {
                    media.dataset.view = media.dataset.view === 'panorama' ? 'carousel' : 'panorama';
                    if (media.dataset.view === 'carousel') {
                        track.scrollLeft = slides[initialIndex]?.offsetLeft - track.offsetLeft || 0;
                    } else {
                        track.scrollLeft = 0;
                    }
                });
                controls.appendChild(viewToggle);
                media.appendChild(controls);
            } else {
                media.appendChild(dots);
                if (peekPercent === 0 && slides.length > 1) {
                    const arrows = (['previous', 'next'] as const).map((direction) => {
                        const arrow = document.createElement('button');
                        arrow.type = 'button';
                        arrow.className = `carousel-arrow carousel-arrow--${direction}`;
                        arrow.setAttribute('aria-label', direction === 'previous' ? 'Previous photo' : 'Next photo');
                        arrow.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${direction === 'previous' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'}"></path></svg>`;
                        media.appendChild(arrow);
                        return arrow;
                    });
                    const activeSlideIndex = () => Math.max(0, slides.findIndex((slide) => slide.hasAttribute('data-active')));
                    const updateArrows = () => {
                        arrows[0].disabled = activeSlideIndex() <= 0;
                        arrows[1].disabled = activeSlideIndex() >= slides.length - 1;
                    };
                    arrows.forEach((arrow, offset) => arrow.addEventListener('click', () => {
                        (dots.children[activeSlideIndex() + (offset === 0 ? -1 : 1)] as HTMLElement | undefined)?.click();
                    }));
                    dots.addEventListener('click', updateArrows);
                    updateArrows();
                    new ResizeObserver(() => {
                        const trackStyle = getComputedStyle(track);
                        const paddingTop = parseFloat(trackStyle.paddingTop) || 0;
                        const paddingBottom = parseFloat(trackStyle.paddingBottom) || 0;
                        media.style.setProperty('--carousel-arrow-top', `${track.offsetTop + paddingTop}px`);
                        media.style.setProperty('--carousel-arrow-height', `${track.offsetHeight - paddingTop - paddingBottom}px`);
                    }).observe(media);
                }
            }
        } else {
            const applyRatios = () => {
                const items = Array.from(track.children) as HTMLElement[];
                const measured = items.flatMap((item) => {
                    const metrics = measureRowItem(item);
                    return metrics ? [{ item, metrics }] : [];
                });
                const flex = rowItemFlex(measured.map(({ metrics }) => metrics));
                measured.forEach(({ item }, index) => { item.style.flex = flex[index]; });
            };
            // Column gaps are read from computed style, so measure once attached.
            requestAnimationFrame(applyRatios);
            track.addEventListener('load', applyRatios, { capture: true });
        }
        if (caption && captionPosition.includes('bottom')) media.appendChild(createCaption(caption, captionPosition));
        fragment.appendChild(media);
    });

    albumContent.replaceChildren(fragment);
    document.dispatchEvent(new CustomEvent('album:content-replaced'));
    albumContent.querySelectorAll<HTMLImageElement>('img[data-dev-fallback-url]').forEach((image) => {
        delete image.dataset.devFallbackReady;
        const useFallback = () => {
            const fallbackUrl = image.dataset.devFallbackUrl;
            if (!fallbackUrl) return;
            delete image.dataset.devFallbackUrl;
            image.src = fallbackUrl;
            const link = image.closest<HTMLAnchorElement>('a.pswp-link');
            if (link) {
                link.href = fallbackUrl;
                link.dataset.pswpSrc = fallbackUrl;
            }
        };
        image.addEventListener('error', useFallback, { once: true });
        if (image.complete && image.naturalWidth === 0) useFallback();
    });
    if (draft.metadata.gap) albumContent.style.setProperty('--album-block-gap', draft.metadata.gap);
    else albumContent.style.removeProperty('--album-block-gap');

    const heading = document.querySelector<HTMLElement>('[data-album-heading]');
    const title = heading?.querySelector<HTMLElement>('[data-album-title]');
    if (title) title.textContent = draft.metadata.title;
    let info = heading?.querySelector<HTMLElement>('[data-album-info]');
    if (draft.metadata.info && heading) {
        if (!info) {
            info = document.createElement('p');
            info.className = 'text-sm text-zinc-500 font-light tracking-wider uppercase';
            info.dataset.albumInfo = '';
            heading.appendChild(info);
        }
        info.textContent = draft.metadata.info;
    } else {
        info?.remove();
    }
    initAlbumMetadataEditor();

    setGlobalTagMode(false);
    activeMarginControl = null;
    void initToolbars();
    initInlineBlockAdder();
    window.requestAnimationFrame(() => initInlineOrderEditor());
};

const directBlockOptions = [
    { label: 'Row', value: 'Row' },
    { label: 'Carousel', value: 'PhotoCarousel' },
    { label: 'Panorama', value: 'PhotoPanorama' },
    { label: 'Text', value: 'Text' },
];

const getDirectPageStructure = async (albumSlug: string) => {
    const response = await fetch(`/api/get-page-structure?albumSlug=${encodeURIComponent(albumSlug)}`, {
        cache: 'no-store',
    });
    if (!response.ok) throw new Error('Failed to load page structure');
    const page = await response.json();
    const blocks = JSON.parse(JSON.stringify(page.blocks || [])).map((block: any, index: number) => ({
        ...block,
        props: { ...(block.props || {}) },
        __devKey: block.__devKey || `persisted-${index}`,
    }));
    const stagedStructure = pendingLayoutChange?.albumSlug === albumSlug
        ? pendingLayoutChange
        : null;
    return {
        draft: stagedStructure
            ? JSON.parse(JSON.stringify(stagedStructure.draft)) as PageStructureDraft
            : {
                blocks,
                metadata: {
                    title: String(page.metadata?.title || ''),
                    info: page.metadata?.info || undefined,
                    gap: page.metadata?.gap || undefined,
                },
                removeLocal: [],
            } as PageStructureDraft,
        imports: stagedStructure ? [...stagedStructure.imports] : [] as File[],
        localPhotoNames: new Set<string>((page.localPhotos || []).map((photo: { name: string }) => photo.name)),
    };
};

const closeAlbumMetadataEditor = () => {
    document.querySelector<HTMLElement>('[data-dev-album-metadata-fields]')?.remove();
    document.querySelector<HTMLButtonElement>('[data-dev-album-metadata-edit]')?.setAttribute('aria-expanded', 'false');
};

const stageDirectAlbumMetadata = async (
    titleValue: string,
    infoValue: string,
    defaultMarginValue: string,
) => {
    if (!canStartEditMode('blocks')) return;
    const albumSlug = getAlbumSlug();
    const title = titleValue.trim();
    if (!albumSlug) return;
    if (!title) return showToast('❌ Album title is required');
    try {
        const page = await getDirectPageStructure(albumSlug);
        page.draft.metadata = {
            ...page.draft.metadata,
            title,
            info: infoValue.trim() || undefined,
            gap: remValueFromInput(defaultMarginValue) || undefined,
        };
        pendingLayoutChange = { albumSlug, draft: page.draft, imports: page.imports };
        closeAlbumMetadataEditor();
        renderPendingPageStructure(albumSlug, page.draft, page.imports);
        updateSaveButtonState();
        showToast('📝 Pending album metadata update');
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to update album metadata'}`);
    }
};

function initAlbumMetadataEditor() {
    const heading = document.querySelector<HTMLElement>('[data-album-heading]');
    const title = heading?.querySelector<HTMLElement>('[data-album-title]');
    if (!heading || !title) return;
    const existingEditor = heading.querySelector<HTMLElement>('.dev-album-metadata-editor');
    const info = heading.querySelector<HTMLElement>('[data-album-info]');
    if (existingEditor) {
        (info || title).insertAdjacentElement('afterend', existingEditor);
        return;
    }
    if (!activeBlockEditMode) return;

    const editor = document.createElement('div');
    editor.className = 'dev-album-metadata-editor';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dev-album-metadata-edit-button';
    button.dataset.devAlbumMetadataEdit = '';
    button.title = 'Edit album metadata';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = ICONS.pencil;
    editor.appendChild(button);
    (info || title).insertAdjacentElement('afterend', editor);

    button.addEventListener('click', () => {
        if (editor.querySelector('[data-dev-album-metadata-fields]')) {
            closeAlbumMetadataEditor();
            return;
        }
        if (!canStartEditMode('blocks')) return;
        closeOtherPageEditors(button);
        const fields = document.createElement('form');
        fields.className = 'dev-album-metadata-fields';
        fields.dataset.devAlbumMetadataFields = '';
        fields.innerHTML = `
            <label>Title<input class="dev-album-metadata-title" type="text" /></label>
            <label>Info<input class="dev-album-metadata-info" type="text" /></label>
            <label>Default block margin<input class="dev-album-metadata-margin" type="number" step="0.1" inputmode="decimal" placeholder="0.5" /></label>
            <div class="dev-album-metadata-actions">
                <button type="submit" title="Stage album metadata" aria-label="Stage album metadata">${ICONS.check}</button>
                <button type="button" data-dev-album-metadata-cancel title="Cancel" aria-label="Cancel">${ICONS.close}</button>
            </div>
        `;
        editor.appendChild(fields);
        button.setAttribute('aria-expanded', 'true');
        const titleInput = fields.querySelector<HTMLInputElement>('.dev-album-metadata-title')!;
        const infoInput = fields.querySelector<HTMLInputElement>('.dev-album-metadata-info')!;
        const marginInput = fields.querySelector<HTMLInputElement>('.dev-album-metadata-margin')!;
        fields.querySelector('[data-dev-album-metadata-cancel]')?.addEventListener('click', closeAlbumMetadataEditor);
        fields.addEventListener('submit', (event) => {
            event.preventDefault();
            void stageDirectAlbumMetadata(titleInput.value, infoInput.value, marginInput.value);
        });
        void getDirectPageStructure(getAlbumSlug() || '')
            .then((page) => {
                titleInput.value = page.draft.metadata.title || '';
                infoInput.value = page.draft.metadata.info || '';
                marginInput.value = remValueForInput(page.draft.metadata.gap);
                titleInput.focus();
            })
            .catch((error) => {
                closeAlbumMetadataEditor();
                showToast(`❌ ${error instanceof Error ? error.message : 'Failed to load album metadata'}`);
            });
    });
}

const stageDirectBlock = async (type: string, insertIndex: number, files: File[] = []) => {
    if (!canStartEditMode('blocks')) return;
    const albumSlug = getAlbumSlug();
    if (!albumSlug) return showToast('❌ Cannot identify album');

    try {
        const page = await getDirectPageStructure(albumSlug);
        const basename = (value: string) => value.replace(/^\/+/, '').split('/').pop() || value;
        const referenced = new Set(page.draft.blocks.flatMap((block: any) =>
            (block.photos || []).map((photo: any) => basename(photo.itemKey)),
        ));
        const pendingNames = new Set(page.imports.map((file) => file.name));
        const incomingNames = new Set<string>();
        const duplicate = files.find((file) => {
            const alreadySeen = incomingNames.has(file.name);
            incomingNames.add(file.name);
            return alreadySeen || referenced.has(file.name) || pendingNames.has(file.name) || page.localPhotoNames.has(file.name);
        });
        if (duplicate) {
            showToast(`❌ ${duplicate.name} already exists in this album; use its existing entry`);
            return;
        }

        const newBlock = type === 'Text'
            ? {
                type: 'Text',
                __devKey: `pending-${crypto.randomUUID()}`,
                props: { blockMargin: '1.5rem' },
                text: '',
                photos: [],
            }
            : {
                type,
                __devKey: `pending-${crypto.randomUUID()}`,
                props: {},
                photos: files.map((file) => ({ itemKey: file.name })),
            };
        page.draft.blocks.splice(insertIndex, 0, newBlock);
        if (type === 'Text') pendingTextBlockEditorKey = newBlock.__devKey;
        pendingLayoutChange = {
            albumSlug,
            draft: page.draft,
            imports: [...page.imports, ...files],
        };
        renderPendingPageStructure(albumSlug, page.draft, pendingLayoutChange.imports);
        updateSaveButtonState();
        showToast('📝 Pending page structure update');
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to add block'}`);
    }
};

const stageDirectBlockPhotos = async (blockKey: string, fallbackIndex: number, files: File[]) => {
    if (!canStartEditMode('blocks')) return;
    const albumSlug = getAlbumSlug();
    if (!albumSlug || files.length === 0) return;

    try {
        const page = await getDirectPageStructure(albumSlug);
        const targetIndex = page.draft.blocks.findIndex((block: any) => block.__devKey === blockKey);
        const targetBlock = page.draft.blocks[targetIndex >= 0 ? targetIndex : fallbackIndex];
        if (!targetBlock || targetBlock.type === 'Text') {
            showToast('❌ Photos can only be added to a media block');
            return;
        }

        const basename = (value: string) => value.replace(/^\/+/, '').split('/').pop() || value;
        const referenced = new Set(page.draft.blocks.flatMap((block: any) =>
            (block.photos || []).map((photo: any) => basename(photo.itemKey)),
        ));
        const pendingNames = new Set(page.imports.map((file) => file.name));
        const incomingNames = new Set<string>();
        const duplicate = files.find((file) => {
            const alreadySeen = incomingNames.has(file.name);
            incomingNames.add(file.name);
            return alreadySeen || referenced.has(file.name) || pendingNames.has(file.name) || page.localPhotoNames.has(file.name);
        });
        if (duplicate) {
            showToast(`❌ ${duplicate.name} already exists in this album; use its existing entry`);
            return;
        }

        targetBlock.photos ||= [];
        targetBlock.photos.push(...files.map((file) => ({ itemKey: file.name })));
        pendingLayoutChange = {
            albumSlug,
            draft: page.draft,
            imports: [...page.imports, ...files],
        };
        renderPendingPageStructure(albumSlug, page.draft, pendingLayoutChange.imports);
        updateSaveButtonState();
        showToast('📝 Pending photos added to block');
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to add photos'}`);
    }
};

const reconcileDirectPhotoRemovals = (page: Awaited<ReturnType<typeof getDirectPageStructure>>) => {
    const basename = (value: string) => value.replace(/^\/+/, '').split('/').pop() || value;
    const referenced = new Set(page.draft.blocks.flatMap((block: any) =>
        (block.photos || []).map((photo: any) => basename(photo.itemKey)),
    ));
    page.draft.removeLocal = [...page.localPhotoNames].filter((name) => !referenced.has(name)).sort();
    page.imports = page.imports.filter((file) => referenced.has(file.name));
};

const findDirectTargetBlock = (
    page: Awaited<ReturnType<typeof getDirectPageStructure>>,
    blockKey: string,
    fallbackIndex: number,
) => {
    const keyedIndex = page.draft.blocks.findIndex((block: any) => block.__devKey === blockKey);
    const index = keyedIndex >= 0 ? keyedIndex : fallbackIndex;
    return { block: page.draft.blocks[index], index };
};

const stageDirectBlockDeletion = async (blockKey: string, fallbackIndex: number) => {
    if (!canStartEditMode('blocks')) return;
    const albumSlug = getAlbumSlug();
    if (!albumSlug) return;
    try {
        const page = await getDirectPageStructure(albumSlug);
        const { block, index } = findDirectTargetBlock(page, blockKey, fallbackIndex);
        if (!block) return showToast('❌ Block is no longer available');
        page.draft.blocks.splice(index, 1);
        reconcileDirectPhotoRemovals(page);
        pendingLayoutChange = { albumSlug, draft: page.draft, imports: page.imports };
        clearActiveInlineBlockAction();
        renderPendingPageStructure(albumSlug, page.draft, page.imports);
        updateSaveButtonState();
        showToast('📝 Pending block deletion');
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to delete block'}`);
    }
};

const stageDirectPhotoDeletion = async (blockKey: string, fallbackIndex: number, photoNames: Set<string>) => {
    if (!canStartEditMode('blocks')) return;
    const albumSlug = getAlbumSlug();
    if (!albumSlug || photoNames.size === 0) return;
    try {
        const page = await getDirectPageStructure(albumSlug);
        const { block, index } = findDirectTargetBlock(page, blockKey, fallbackIndex);
        if (!block || block.type === 'Text') return showToast('❌ Photos are no longer available');
        const basename = (value: string) => value.replace(/^\/+/, '').split('/').pop() || value;
        block.photos = (block.photos || []).filter((photo: any) => !photoNames.has(basename(photo.itemKey)));
        if (block.photos.length === 0) page.draft.blocks.splice(index, 1);
        reconcileDirectPhotoRemovals(page);
        pendingLayoutChange = { albumSlug, draft: page.draft, imports: page.imports };
        clearActiveInlineBlockAction();
        renderPendingPageStructure(albumSlug, page.draft, page.imports);
        updateSaveButtonState();
        showToast('📝 Pending photo deletion');
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to delete photos'}`);
    }
};

const stageDirectInitialPhoto = async (
    blockKey: string,
    fallbackIndex: number,
    photoName: string,
    pendingType?: 'PhotoCarousel' | 'PhotoPanorama',
) => {
    if (!canStartEditMode('blocks')) return;
    const albumSlug = getAlbumSlug();
    if (!albumSlug || !photoName) return;
    try {
        const page = await getDirectPageStructure(albumSlug);
        const { block } = findDirectTargetBlock(page, blockKey, fallbackIndex);
        if (!block || (!isCarouselLikeType(block.type) && !pendingType)) {
            return showToast('❌ This is no longer a carousel');
        }
        if (pendingType) block.type = pendingType;
        const basename = (value: string) => value.replace(/^\/+/, '').split('/').pop() || value;
        const initialSlide = (block.photos || []).findIndex((photo: any) => basename(photo.itemKey) === photoName);
        if (initialSlide < 0) return showToast('❌ Photo is no longer available');
        block.props ||= {};
        if (initialSlide > 0) block.props.initialSlide = initialSlide;
        else delete block.props.initialSlide;
        pendingLayoutChange = { albumSlug, draft: page.draft, imports: page.imports };
        clearActiveInlineBlockAction();
        renderPendingPageStructure(albumSlug, page.draft, page.imports);
        updateSaveButtonState();
        showToast('📝 Pending initial photo update');
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to set initial photo'}`);
    }
};

const stageDirectInitialView = async (
    blockKey: string,
    fallbackIndex: number,
    initialView: 'carousel' | 'panorama',
    allowPendingPanorama = false,
) => {
    if (!canStartEditMode('blocks')) return;
    const albumSlug = getAlbumSlug();
    if (!albumSlug) return;
    try {
        const page = await getDirectPageStructure(albumSlug);
        const { block } = findDirectTargetBlock(page, blockKey, fallbackIndex);
        if (!block || (block.type !== 'PhotoPanorama' && !allowPendingPanorama)) {
            return showToast('❌ This is no longer a panorama');
        }
        block.type = 'PhotoPanorama';
        block.props ||= {};
        if (initialView === 'panorama') block.props.initialView = 'panorama';
        else delete block.props.initialView;
        pendingLayoutChange = { albumSlug, draft: page.draft, imports: page.imports };
        clearActiveInlineBlockAction();
        renderPendingPageStructure(albumSlug, page.draft, page.imports);
        updateSaveButtonState();
        showToast(`📝 Pending initial view: ${initialView}`);
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to set initial view'}`);
    }
};

const stageDirectPeekPercent = async (
    blockKey: string,
    fallbackIndex: number,
    peekPercent: number,
    pendingType?: 'PhotoCarousel' | 'PhotoPanorama',
) => {
    if (!canStartEditMode('blocks')) return;
    const albumSlug = getAlbumSlug();
    if (!albumSlug) return;
    try {
        const page = await getDirectPageStructure(albumSlug);
        const { block } = findDirectTargetBlock(page, blockKey, fallbackIndex);
        if (!block || (block.type !== 'PhotoCarousel' && pendingType !== 'PhotoCarousel')) {
            return showToast('❌ This is no longer a carousel');
        }
        block.type = 'PhotoCarousel';
        block.props ||= {};
        if (peekPercent > 0) block.props.peekPercent = peekPercent;
        else delete block.props.peekPercent;
        pendingLayoutChange = { albumSlug, draft: page.draft, imports: page.imports };
        clearActiveInlineBlockAction();
        renderPendingPageStructure(albumSlug, page.draft, page.imports);
        updateSaveButtonState();
        showToast(`📝 Pending carousel peek: ${peekPercent}%`);
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to set carousel peek'}`);
    }
};

const stageDirectPanoramaSlices = async (
    blockKey: string,
    fallbackIndex: number,
    slices: number,
    allowPendingPanorama = false,
) => {
    if (!canStartEditMode('blocks')) return;
    const albumSlug = getAlbumSlug();
    if (!albumSlug) return;
    try {
        const page = await getDirectPageStructure(albumSlug);
        const { block } = findDirectTargetBlock(page, blockKey, fallbackIndex);
        if (!block || (block.type !== 'PhotoPanorama' && !allowPendingPanorama)) {
            return showToast('❌ This is no longer a panorama');
        }
        if ((block.photos || []).length !== 1) return showToast('❌ Slices require a single-photo panorama');
        block.type = 'PhotoPanorama';
        block.props ||= {};
        if (slices > 1) block.props.panoramaSlices = slices;
        else delete block.props.panoramaSlices;
        pendingLayoutChange = { albumSlug, draft: page.draft, imports: page.imports };
        clearActiveInlineBlockAction();
        renderPendingPageStructure(albumSlug, page.draft, page.imports);
        updateSaveButtonState();
        showToast(`📝 Pending panorama slices: ${slices}`);
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to set panorama slices'}`);
    }
};

const chooseDirectBlockPhotos = (type: string, insertIndex: number) => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,image/webp,image/avif';
    picker.multiple = true;
    picker.hidden = true;
    picker.addEventListener('change', () => {
        const files = Array.from(picker.files || []);
        picker.remove();
        if (files.length) void stageDirectBlock(type, insertIndex, files);
    }, { once: true });
    document.body.appendChild(picker);
    picker.click();
};

const chooseDirectBlockPhotoAddition = (blockKey: string, fallbackIndex: number) => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,image/webp,image/avif';
    picker.multiple = true;
    picker.hidden = true;
    picker.addEventListener('change', () => {
        const files = Array.from(picker.files || []);
        picker.remove();
        if (files.length) void stageDirectBlockPhotos(blockKey, fallbackIndex, files);
    }, { once: true });
    document.body.appendChild(picker);
    picker.click();
};

const directPhotoName = (wrapper: HTMLElement) => {
    const itemKey = wrapper.dataset.panoramaSourceItemKey || wrapper.dataset.itemKey || '';
    return itemKey.replace(/^\/+/, '').split('/').pop() || '';
};

const clearActiveInlineBlockAction = () => {
    activeInlineBlockAction = null;
    document.querySelectorAll<HTMLElement>('.dev-block-photo-action').forEach((block) => {
        block.classList.remove('dev-block-photo-action', 'dev-block-photo-action--initial');
        block.querySelectorAll('.dev-inline-photo-selected').forEach((photo) => photo.classList.remove('dev-inline-photo-selected'));
    });
    document.querySelector('.dev-page-inline-action-menu')?.remove();
};

const updateInlineBlockPhotoSelection = (block: HTMLElement) => {
    const action = activeInlineBlockAction;
    if (!action) return;
    block.querySelectorAll<HTMLElement>('.photo-wrapper').forEach((wrapper) => {
        wrapper.classList.toggle('dev-inline-photo-selected', action.selectedPhotos.has(directPhotoName(wrapper)));
    });
    const confirm = document.querySelector<HTMLButtonElement>('[data-inline-action-confirm]');
    if (confirm) confirm.disabled = action.selectedPhotos.size === 0;
};

const startInlineBlockPhotoAction = (
    kind: 'delete-photos' | 'set-initial-photo',
    block: HTMLElement,
    blockKey: string,
    fallbackIndex: number,
) => {
    clearInlineOrderInteraction();
    activeInlineBlockAction = { kind, blockKey, fallbackIndex, selectedPhotos: new Set() };
    block.classList.add('dev-block-photo-action');
    block.classList.toggle('dev-block-photo-action--initial', kind === 'set-initial-photo');
    if (!block.dataset.devPhotoActionBound) {
        block.dataset.devPhotoActionBound = 'true';
        block.addEventListener('pointerdown', (event) => {
            if (!activeInlineBlockAction || !(event.target as HTMLElement).closest('.photo-wrapper')) return;
            event.preventDefault();
            event.stopPropagation();
        }, true);
        block.addEventListener('click', (event) => {
            const action = activeInlineBlockAction;
            const target = event.target as HTMLElement;
            const wrapper = target.closest<HTMLElement>('.photo-wrapper');
            if (!action || action.blockKey !== block.dataset.devBlockKey || !wrapper || !block.contains(wrapper)) return;
            event.preventDefault();
            event.stopPropagation();
            const photoName = directPhotoName(wrapper);
            if (!photoName) return;
            if (action.kind === 'set-initial-photo') {
                action.selectedPhotos.clear();
                action.selectedPhotos.add(photoName);
            } else if (action.selectedPhotos.has(photoName)) {
                action.selectedPhotos.delete(photoName);
            } else {
                action.selectedPhotos.add(photoName);
            }
            updateInlineBlockPhotoSelection(block);
        }, true);
    }
    updateInlineBlockPhotoSelection(block);
};

const positionInlineActionMenu = (menu: HTMLElement, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, rect.left + rect.width / 2 - menu.offsetWidth / 2)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
};

const openInlineBlockActionMenu = (
    anchor: HTMLElement,
    block: HTMLElement,
    targetBlock: {
        key: string;
        index: number;
        isMedia: boolean;
        isCarousel: boolean;
        isPanorama: boolean;
        pendingType?: 'PhotoCarousel' | 'PhotoPanorama';
    },
) => {
    closeOtherPageEditors(anchor);
    clearActiveInlineBlockAction();
    const menu = document.createElement('div');
    menu.className = 'dev-page-inline-add-menu dev-page-inline-action-menu';
    const closeMenu = (event: MouseEvent) => {
        if (menu.contains(event.target as Node) || event.target === anchor) return;
        clearActiveInlineBlockAction();
        document.removeEventListener('click', closeMenu);
    };
    const showConfirmation = (kind: InlineBlockAction['kind']) => {
        if (kind !== 'delete-block') startInlineBlockPhotoAction(kind, block, targetBlock.key, targetBlock.index);
        menu.replaceChildren();
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.setAttribute('data-inline-action-confirm', kind === 'set-initial-photo' ? 'initial' : 'delete');
        confirm.title = kind === 'set-initial-photo' ? 'Confirm initial photo' : 'Confirm deletion';
        confirm.setAttribute('aria-label', confirm.title);
        confirm.innerHTML = kind === 'set-initial-photo' ? ICONS.check : ICONS.trash;
        confirm.disabled = kind !== 'delete-block';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.title = 'Cancel';
        cancel.setAttribute('aria-label', 'Cancel');
        cancel.innerHTML = ICONS.close;
        cancel.addEventListener('click', (event) => {
            event.stopPropagation();
            clearActiveInlineBlockAction();
            document.removeEventListener('click', closeMenu);
        });
        confirm.addEventListener('click', (event) => {
            event.stopPropagation();
            const action = activeInlineBlockAction;
            if (kind === 'delete-block') void stageDirectBlockDeletion(targetBlock.key, targetBlock.index);
            else if (kind === 'delete-photos' && action) void stageDirectPhotoDeletion(targetBlock.key, targetBlock.index, action.selectedPhotos);
            else if (kind === 'set-initial-photo' && action) {
                void stageDirectInitialPhoto(
                    targetBlock.key,
                    targetBlock.index,
                    [...action.selectedPhotos][0],
                    targetBlock.pendingType,
                );
            }
            document.removeEventListener('click', closeMenu);
        });
        menu.append(confirm, cancel);
        positionInlineActionMenu(menu, anchor);
    };
    const addOption = (label: string, kind: InlineBlockAction['kind']) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.textContent = label;
        option.addEventListener('click', (event) => {
            event.stopPropagation();
            showConfirmation(kind);
        });
        menu.appendChild(option);
    };
    const showInitialViewOptions = () => {
        menu.replaceChildren();
        (['carousel', 'panorama'] as const).forEach((initialView) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.textContent = initialView === 'carousel' ? 'Carousel' : 'Panorama';
            option.addEventListener('click', (event) => {
                event.stopPropagation();
                menu.remove();
                document.removeEventListener('click', closeMenu);
                void stageDirectInitialView(
                    targetBlock.key,
                    targetBlock.index,
                    initialView,
                    targetBlock.isPanorama,
                );
            });
            menu.appendChild(option);
        });
        positionInlineActionMenu(menu, anchor);
    };
    const showNumberInput = (options: {
        label: string;
        title: string;
        min: number;
        max: number;
        value: number;
        submit: (value: number) => void;
    }) => {
        menu.replaceChildren();
        const label = document.createElement('label');
        label.className = 'dev-inline-number-label';
        label.textContent = options.label;
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'dev-inline-number-input';
        input.min = String(options.min);
        input.max = String(options.max);
        input.step = '1';
        input.inputMode = 'numeric';
        input.value = String(options.value);
        label.appendChild(input);
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.setAttribute('data-inline-action-confirm', 'initial');
        confirm.title = options.title;
        confirm.setAttribute('aria-label', confirm.title);
        confirm.innerHTML = ICONS.check;
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.title = 'Cancel';
        cancel.setAttribute('aria-label', 'Cancel');
        cancel.innerHTML = ICONS.close;
        const submit = () => {
            const value = Math.min(options.max, Math.max(options.min, Math.trunc(Number(input.value) || options.min)));
            menu.remove();
            document.removeEventListener('click', closeMenu);
            options.submit(value);
        };
        confirm.addEventListener('click', (event) => {
            event.stopPropagation();
            submit();
        });
        cancel.addEventListener('click', (event) => {
            event.stopPropagation();
            clearActiveInlineBlockAction();
            document.removeEventListener('click', closeMenu);
        });
        input.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') submit();
            else if (event.key === 'Escape') {
                clearActiveInlineBlockAction();
                document.removeEventListener('click', closeMenu);
            }
        });
        menu.append(label, confirm, cancel);
        positionInlineActionMenu(menu, anchor);
        input.focus();
        input.select();
    };
    const showPanoramaSlicesInput = () => showNumberInput({
        label: 'Slices',
        title: 'Confirm slices',
        min: 1,
        max: 24,
        value: Math.min(24, Math.max(1, Number.parseInt(block.dataset.panoramaSlices || '1', 10) || 1)),
        submit: (slices) => void stageDirectPanoramaSlices(targetBlock.key, targetBlock.index, slices, targetBlock.isPanorama),
    });
    const showPeekPercentInput = () => showNumberInput({
        label: 'Peek %',
        title: 'Confirm peek',
        min: 0,
        max: 90,
        value: Math.min(90, Math.max(0, Number.parseInt(block.dataset.peekPercent || '0', 10) || 0)),
        submit: (peekPercent) => void stageDirectPeekPercent(targetBlock.key, targetBlock.index, peekPercent, targetBlock.pendingType),
    });
    addOption('Delete Block', 'delete-block');
    if (targetBlock.isMedia) addOption('Delete Photos', 'delete-photos');
    if (targetBlock.isCarousel) addOption('Set Initial Photo', 'set-initial-photo');
    if (targetBlock.isCarousel && !targetBlock.isPanorama) {
        const peekOption = document.createElement('button');
        peekOption.type = 'button';
        peekOption.textContent = 'Set Peek';
        peekOption.addEventListener('click', (event) => {
            event.stopPropagation();
            showPeekPercentInput();
        });
        menu.appendChild(peekOption);
    }
    if (targetBlock.isPanorama) {
        const initialViewOption = document.createElement('button');
        initialViewOption.type = 'button';
        initialViewOption.textContent = 'Set Initial View';
        initialViewOption.addEventListener('click', (event) => {
            event.stopPropagation();
            showInitialViewOptions();
        });
        menu.appendChild(initialViewOption);
        const photoNames = new Set(
            Array.from(block.querySelectorAll<HTMLElement>('.photo-wrapper')).map(directPhotoName).filter(Boolean),
        );
        if (photoNames.size === 1) {
            const slicesOption = document.createElement('button');
            slicesOption.type = 'button';
            slicesOption.textContent = 'Set Slices';
            slicesOption.addEventListener('click', (event) => {
                event.stopPropagation();
                showPanoramaSlicesInput();
            });
            menu.appendChild(slicesOption);
        }
    }
    document.body.appendChild(menu);
    positionInlineActionMenu(menu, anchor);
    window.setTimeout(() => document.addEventListener('click', closeMenu), 0);
};

const openDirectBlockMenu = (
    anchor: HTMLElement,
    insertIndex: number,
    targetBlock?: { key: string; index: number; isMedia: boolean },
) => {
    closeOtherPageEditors(anchor);
    document.querySelector('.dev-page-inline-add-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'dev-page-inline-add-menu';
    directBlockOptions.forEach(({ label, value }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.remove();
            document.removeEventListener('click', closeMenu);
            if (value === 'Text') void stageDirectBlock(value, insertIndex);
            else chooseDirectBlockPhotos(value, insertIndex);
        });
        menu.appendChild(button);
    });
    if (targetBlock?.isMedia) {
        const addPhotosButton = document.createElement('button');
        addPhotosButton.type = 'button';
        addPhotosButton.textContent = 'Add Photos';
        addPhotosButton.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.remove();
            document.removeEventListener('click', closeMenu);
            chooseDirectBlockPhotoAddition(targetBlock.key, targetBlock.index);
        });
        menu.appendChild(addPhotosButton);
    }
    document.body.appendChild(menu);
    const position = () => {
        const rect = anchor.getBoundingClientRect();
        menu.style.left = `${Math.max(8, rect.left + rect.width / 2 - menu.offsetWidth / 2)}px`;
        menu.style.top = `${rect.bottom + 4}px`;
    };
    position();
    const closeMenu = (event: MouseEvent) => {
        if (menu.contains(event.target as Node) || event.target === anchor) return;
        menu.remove();
        document.removeEventListener('click', closeMenu);
    };
    window.setTimeout(() => document.addEventListener('click', closeMenu), 0);
};

function initInlineBlockAdder() {
    const albumContent = document.querySelector<HTMLElement>('.album-content');
    if (!albumContent) return;

    albumContent.querySelectorAll<HTMLElement>('.dev-page-inline-add-zone').forEach((zone) => {
        const toolbar = zone.closest<HTMLElement>('[data-dev-block]')?.querySelector<HTMLElement>('.dev-block-toolbar');
        zone.querySelectorAll<HTMLElement>('.dev-inline-margin-control, .dev-inline-block-type-control, .dev-btn-caption, .dev-btn-text')
            .forEach((control) => toolbar?.appendChild(control));
        zone.remove();
    });
    const blocks = Array.from(albumContent.querySelectorAll<HTMLElement>(':scope > [data-dev-block]'));
    const createAddZone = (insertIndex: number, before = false, block?: HTMLElement) => {
        const addZone = document.createElement('div');
        addZone.className = `dev-page-inline-add-zone${before ? ' dev-page-inline-add-zone--before' : ''}`;
        if (block && !before) {
            const marginControl = block.querySelector<HTMLElement>('.dev-block-toolbar .dev-inline-margin-control');
            const blockTypeControl = block.querySelector<HTMLElement>('.dev-block-toolbar .dev-inline-block-type-control');
            if (marginControl) addZone.appendChild(marginControl);
            if (blockTypeControl) addZone.appendChild(blockTypeControl);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dev-page-inline-add-button';
        button.title = before ? 'Add block before' : 'Add block after';
        button.setAttribute('aria-label', button.title);
        button.innerHTML = ICONS.plus;
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            openDirectBlockMenu(
                button,
                insertIndex,
                block
                    ? {
                        key: block.dataset.devBlockKey || `persisted-${insertIndex - 1}`,
                        index: insertIndex - 1,
                        isMedia: block.dataset.devBlock !== 'text',
                    }
                    : undefined,
            );
        });
        addZone.appendChild(button);
        if (block && !before) {
            const getTargetBlock = () => {
                const stagedBlockTypeChange = pendingBlockTypeChanges.get(block.dataset.devTypeChangeKey || '');
                const stagedType = stagedBlockTypeChange?.targetType;
                const displayedType = stagedType || block.dataset.devSourceType || block.dataset.devBlock;
                const isPanorama = stagedType ? stagedType === 'PhotoPanorama' : block.dataset.devPanorama === 'true';
                return {
                    key: block.dataset.devBlockKey || `persisted-${insertIndex - 1}`,
                    index: insertIndex - 1,
                    isMedia: block.dataset.devBlock !== 'text',
                    isCarousel: isCarouselLikeType(displayedType) || displayedType === 'carousel',
                    isPanorama,
                    pendingType: stagedType && stagedType !== 'Row' ? stagedType : undefined,
                };
            };
            const moreButton = document.createElement('button');
            moreButton.type = 'button';
            moreButton.className = 'dev-page-inline-more-button';
            moreButton.title = 'Block actions';
            moreButton.setAttribute('aria-label', 'Block actions');
            moreButton.innerHTML = ICONS.dots;
            moreButton.addEventListener('click', (event) => {
                event.stopPropagation();
                openInlineBlockActionMenu(moreButton, block, getTargetBlock());
            });
            addZone.appendChild(moreButton);
        }
        if (block && !before) {
            const editButton = block.querySelector<HTMLElement>('.dev-block-toolbar .dev-btn-caption, .dev-block-toolbar .dev-btn-text');
            if (editButton) addZone.appendChild(editButton);
        }
        return addZone;
    };

    if (blocks.length === 0) return;
    blocks[0].appendChild(createAddZone(0, true));
    blocks.forEach((block, index) => block.appendChild(createAddZone(index + 1, false, block)));
}

const inlineOrderPhotoName = (wrapper: HTMLElement) => directPhotoName(wrapper);

const getInlineOrderPhotoPosition = (blocks: any[], photoName: string) => {
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const photoIndex = (blocks[blockIndex].photos || []).findIndex((photo: any) =>
            (photo.itemKey || '').replace(/^.*\//, '') === photoName,
        );
        if (photoIndex >= 0) return { blockIndex, photoIndex };
    }
    return null;
};

const stageInlineOrderChange = (
    albumSlug: string,
    page: Awaited<ReturnType<typeof getDirectPageStructure>>,
    message: string,
) => {
    reconcileDirectPhotoRemovals(page);
    pendingLayoutChange = { albumSlug, draft: page.draft, imports: page.imports };
    renderPendingPageStructure(albumSlug, page.draft, page.imports);
    updateSaveButtonState();
    showToast(message);
};

const clearInlineOrderInteraction = () => {
    inlineOrderPhotoAction = null;
    inlineOrderSelectedPhotoNames.clear();
    inlineOrderLastSelectedPhotoName = null;
    inlineOrderMove = null;
    if (activeOrderMode) initInlineOrderEditor();
};

const cancelInlineOrderMove = () => {
    if (!inlineOrderMove) return false;
    inlineOrderMove = null;
    initInlineOrderEditor();
    return true;
};

const updateInlineFocusedActionState = () => {
    document.documentElement.classList.toggle(
        'dev-inline-focused-action',
        activeTagMode
            || inlineOrderPhotoAction !== null
            || inlineOrderMove !== null,
    );
};

const toggleInlineTagMode = () => {
    clearActiveInlineBlockAction();
    inlineOrderPhotoAction = null;
    inlineOrderSelectedPhotoNames.clear();
    inlineOrderLastSelectedPhotoName = null;
    inlineOrderMove = null;
    setGlobalTagMode(!activeTagMode);
    initInlineOrderEditor();
};

type InlineOrderDrop = {
    direction: MoveDirection;
    targetBlockKey: string;
    targetPhotoName?: string;
    rect: DOMRect;
};
const inlineOrderMoveLabels = { photo: 'Photo', column: 'Column', block: 'Block' } as const;

const inlineOrderBlockKey = (block: HTMLElement) => block.dataset.devBlockKey
    || `persisted-${Array.from(document.querySelectorAll('.album-content [data-dev-block]')).indexOf(block)}`;

// Columns only exist inside Rows; a lone photo has no column level.
const inlineOrderColumnOf = (wrapper: HTMLElement) => {
    const column = wrapper.closest<HTMLElement>('.photo-column');
    return column?.closest<HTMLElement>('[data-dev-block]')?.dataset.devBlock === 'row' ? column : null;
};

const inlineOrderMoveElement = () => {
    const move = inlineOrderMove;
    if (!move) return null;
    const block = Array.from(document.querySelectorAll<HTMLElement>('.album-content [data-dev-block]'))
        .find((candidate) => inlineOrderBlockKey(candidate) === move.blockKey);
    if (!block || move.level === 'block') return block || null;
    const wrapper = Array.from(block.querySelectorAll<HTMLElement>('.photo-wrapper'))
        .find((candidate) => inlineOrderPhotoName(candidate) === move.photoName);
    if (!wrapper) return null;
    return move.level === 'photo' ? wrapper : inlineOrderColumnOf(wrapper);
};

const resolveInlineOrderDrop = (event: MouseEvent, block: HTMLElement): InlineOrderDrop | null => {
    const move = inlineOrderMove;
    const target = event.target as HTMLElement;
    if (!move || inlineOrderMoveElement()?.contains(target)) return null;
    const targetBlockKey = inlineOrderBlockKey(block);
    if (move.level === 'block') {
        const rect = block.getBoundingClientRect();
        const direction = event.clientY < rect.top + rect.height / 2 ? 'up' : 'down';
        return targetBlockKey === move.blockKey ? null : { direction, targetBlockKey, rect };
    }

    const wrapper = target.closest<HTMLElement>('.photo-wrapper');
    const targetPhotoName = wrapper ? inlineOrderPhotoName(wrapper) : '';
    const isRow = block.dataset.devBlock === 'row';
    if (!wrapper || !targetPhotoName || (move.level === 'column' && !isRow)) return null;
    // Diagonals split the photo into four zones; only Rows accept up/down.
    const zone = wrapper.getBoundingClientRect();
    const dx = (event.clientX - zone.left) / zone.width - 0.5;
    const dy = (event.clientY - zone.top) / zone.height - 0.5;
    const direction: MoveDirection = !isRow || Math.abs(dx) >= Math.abs(dy)
        ? dx < 0 ? 'left' : 'right'
        : dy < 0 ? 'up' : 'down';
    // Sideways drops land beside the whole Row cell, so the line spans the Column.
    const cell = direction === 'left' || direction === 'right'
        ? inlineOrderColumnOf(wrapper) || wrapper
        : wrapper;
    return { direction, targetBlockKey, targetPhotoName, rect: cell.getBoundingClientRect() };
};

const showInlineOrderDropIndicator = (drop: InlineOrderDrop | null) => {
    document.documentElement.classList.toggle('dev-order-can-drop', Boolean(drop));
    let indicator = document.querySelector<HTMLElement>('.dev-order-drop-indicator');
    if (!drop) {
        indicator?.remove();
        return;
    }
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'dev-order-drop-indicator';
        document.body.appendChild(indicator);
    }
    // Tint the target half and edge it on the side the selection lands.
    const { rect, direction } = drop;
    const horizontal = direction === 'left' || direction === 'right';
    const width = horizontal ? rect.width / 2 : rect.width;
    const height = horizontal ? rect.height : rect.height / 2;
    indicator.dataset.direction = direction;
    indicator.style.left = `${(direction === 'right' ? rect.right - width : rect.left) + window.scrollX}px`;
    indicator.style.top = `${(direction === 'down' ? rect.bottom - height : rect.top) + window.scrollY}px`;
    indicator.style.width = `${width}px`;
    indicator.style.height = `${height}px`;
};

const clearInlineOrderMoveMarks = () => {
    document.querySelectorAll('.dev-order-move-frame').forEach((frame) => frame.remove());
    document.querySelectorAll<HTMLElement>('.dev-order-move-selected').forEach((element) => {
        element.classList.remove('dev-order-move-selected');
    });
    showInlineOrderDropIndicator(null);
};

const moveInlineOrderSelection = async (drop: InlineOrderDrop) => {
    const move = inlineOrderMove;
    const albumSlug = getAlbumSlug();
    if (!move || !albumSlug) return;

    try {
        const page = await getDirectPageStructure(albumSlug);
        const moved = move.level === 'block'
            ? movePageBlock(page.draft.blocks, move.blockKey, drop.targetBlockKey, drop.direction === 'up' ? 'up' : 'down')
            : movePagePhotos(
                page.draft.blocks,
                { level: move.level, photoName: move.photoName },
                drop.targetPhotoName || '',
                drop.direction,
                () => `pending-${crypto.randomUUID()}`,
            );
        if (!moved) return showToast('❌ Selection can no longer move there');
        inlineOrderMove = null;
        // The preview clones photo nodes from the live page; drop selection marks first.
        clearInlineOrderMoveMarks();
        stageInlineOrderChange(albumSlug, page, `📝 Pending ${inlineOrderMoveLabels[move.level].toLowerCase()} move`);
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to move selection'}`);
    }
};

const createBlocksFromInlineOrderSelection = async (action: Exclude<InlineOrderPhotoAction, null>) => {
    const albumSlug = getAlbumSlug();
    if (!albumSlug) return;
    const minimumSelection = action === 'merge' ? 2 : 1;
    if (inlineOrderSelectedPhotoNames.size < minimumSelection) {
        return showToast(
            action === 'merge'
                ? '⚠️ Select at least two photos'
                : '⚠️ Select at least one photo',
        );
    }

    try {
        const page = await getDirectPageStructure(albumSlug);
        const selectedPhotos = page.draft.blocks.flatMap((block: any) =>
            (block.photos || []).filter((photo: any) =>
                inlineOrderSelectedPhotoNames.has((photo.itemKey || '').replace(/^.*\//, '')),
            ),
        ).map(({ column: _column, ...photo }: any) => photo);
        const lastSelectedName = inlineOrderLastSelectedPhotoName;
        const lastSource = lastSelectedName
            ? getInlineOrderPhotoPosition(page.draft.blocks, lastSelectedName)
            : null;
        if (!lastSource || selectedPhotos.length < minimumSelection) {
            return showToast('❌ Selected photos are no longer available');
        }
        const lastSourceKey = page.draft.blocks[lastSource.blockIndex].__devKey;
        page.draft.blocks.forEach((block: any) => {
            if (block.type !== 'Text') {
                block.photos = (block.photos || []).filter((photo: any) =>
                    !inlineOrderSelectedPhotoNames.has((photo.itemKey || '').replace(/^.*\//, '')),
                );
            }
        });
        const insertionBeforeRemoval = page.draft.blocks
            .slice(0, lastSource.blockIndex)
            .filter((block: any) => block.type === 'Text' || (block.photos || []).length > 0).length;
        page.draft.blocks = page.draft.blocks.filter((block: any) =>
            block.type === 'Text' || (block.photos || []).length > 0,
        );
        const survivingLastSource = page.draft.blocks.findIndex((block: any) => block.__devKey === lastSourceKey);
        const insertIndex = survivingLastSource >= 0 ? survivingLastSource + 1 : insertionBeforeRemoval;
        const newBlocks = action === 'merge'
            ? [{ type: 'Row', __devKey: `pending-${crypto.randomUUID()}`, props: {}, photos: selectedPhotos }]
            : selectedPhotos.map((photo: any) => ({
                type: 'Row',
                __devKey: `pending-${crypto.randomUUID()}`,
                props: {},
                photos: [photo],
            }));
        page.draft.blocks.splice(insertIndex, 0, ...newBlocks);
        inlineOrderPhotoAction = null;
        inlineOrderSelectedPhotoNames.clear();
        inlineOrderLastSelectedPhotoName = null;
        stageInlineOrderChange(
            albumSlug,
            page,
            action === 'merge' ? '📝 Pending photo merge' : '📝 Pending individual photo blocks',
        );
    } catch (error) {
        showToast(`❌ ${error instanceof Error ? error.message : 'Failed to create blocks'}`);
    }
};

const triggerInlinePhotoAction = (action: Exclude<InlineOrderPhotoAction, null>) => {
    if (pendingSaveInProgress) return;
    if (inlineOrderPhotoAction === action) {
        if (inlineOrderSelectedPhotoNames.size === 0) {
            clearInlineOrderInteraction();
            return;
        }
        void createBlocksFromInlineOrderSelection(action);
        return;
    }
    clearActiveInlineBlockAction();
    setGlobalTagMode(false);
    inlineOrderPhotoAction = action;
    inlineOrderSelectedPhotoNames.clear();
    inlineOrderLastSelectedPhotoName = null;
    inlineOrderMove = null;
    initInlineOrderEditor();
};

function initInlineOrderEditor() {
    inlineOrderInteractionAbortController?.abort();
    inlineOrderInteractionAbortController = null;
    document.querySelector<HTMLElement>('[data-dev-inline-order-actions]')?.remove();
    clearInlineOrderMoveMarks();
    updateInlineFocusedActionState();
    if (!activeOrderMode) {
        document.querySelectorAll<HTMLElement>('.dev-order-photo-selected').forEach((photo) => {
            photo.classList.remove('dev-order-photo-selected');
        });
        return;
    }
    const interactionAbortController = new AbortController();
    inlineOrderInteractionAbortController = interactionAbortController;

    const orderButton = document.getElementById('dev-save-btn');
    const scrollContainer = document.querySelector('.fixed.bottom-8.right-8.flex-col');
    if (orderButton) {
        const actions = document.createElement('div');
        actions.className = 'dev-order-actions';
        actions.dataset.devInlineOrderActions = '';
        const managerButton = document.createElement('button');
        managerButton.type = 'button';
        managerButton.className = 'dev-gear-btn in-container dev-order-action-button';
        managerButton.title = 'Open order manager';
        managerButton.setAttribute('aria-label', managerButton.title);
        managerButton.innerHTML = ICONS.order;
        managerButton.addEventListener('click', () => {
            clearActiveInlineBlockAction();
            clearInlineOrderInteraction();
            void openPageManager(true);
        });

        const tagButton = document.createElement('button');
        tagButton.id = 'dev-tag-toggle';
        tagButton.type = 'button';
        tagButton.className = `dev-gear-btn in-container dev-order-action-button dev-tag-toggle${activeTagMode ? ' is-active' : ''}`;
        tagButton.innerHTML = ICONS.pin;
        tagButton.addEventListener('click', () => {
            if (pendingSaveInProgress) return;
            toggleInlineTagMode();
        });
        updateGlobalTagPendingIndicator();

        const createPhotoActionButton = (
            action: Exclude<InlineOrderPhotoAction, null>,
            label: string,
            icon: string,
        ) => {
            const button = document.createElement('button');
            button.type = 'button';
            const isActive = inlineOrderPhotoAction === action;
            const hasSelection = isActive && inlineOrderSelectedPhotoNames.size > 0;
            button.className = `dev-gear-btn in-container dev-order-action-button${isActive ? ' is-active' : ''}`;
            button.title = isActive
                ? hasSelection
                    ? `${label}: ${inlineOrderSelectedPhotoNames.size} selected; click to confirm`
                    : `${label}: click again to cancel`
                : label;
            button.setAttribute('aria-label', button.title);
            button.innerHTML = hasSelection ? ICONS.check : icon;
            button.addEventListener('click', () => triggerInlinePhotoAction(action));
            return button;
        };
        actions.append(
            tagButton,
            managerButton,
            createPhotoActionButton('merge', 'Merge selected photos', ICONS.mergeArrows),
            createPhotoActionButton('split', 'Split selected photos', ICONS.splitArrows),
        );
        if (scrollContainer?.contains(orderButton)) scrollContainer.insertBefore(actions, orderButton.nextElementSibling);
        else orderButton.insertAdjacentElement('afterend', actions);
        updateGlobalTagPendingIndicator();
    }

    const blocks = Array.from(document.querySelectorAll<HTMLElement>('.album-content [data-dev-block]'));
    if (blocks.length === 0) {
        window.setTimeout(() => {
            if (activeOrderMode) initInlineOrderEditor();
        }, 50);
        return;
    }
    if (activeTagMode) return;
    document.querySelectorAll<HTMLElement>('.album-content [data-dev-block] .photo-wrapper').forEach((wrapper) => {
        const photoName = inlineOrderPhotoName(wrapper);
        if (!photoName) return;
        wrapper.classList.toggle('dev-order-photo-selected', inlineOrderSelectedPhotoNames.has(photoName));
        if (!inlineOrderPhotoAction) return;
        wrapper.addEventListener('click', (event) => {
            if ((event.target as HTMLElement).closest('.dev-tag-edit-btn, .tag-link')) return;
            if (activeInlineBlockAction) return;
            event.preventDefault();
            event.stopPropagation();
            if (inlineOrderSelectedPhotoNames.has(photoName)) {
                inlineOrderSelectedPhotoNames.delete(photoName);
                if (inlineOrderLastSelectedPhotoName === photoName) inlineOrderLastSelectedPhotoName = null;
            } else {
                inlineOrderSelectedPhotoNames.add(photoName);
                inlineOrderLastSelectedPhotoName = photoName;
            }
            initInlineOrderEditor();
        }, { capture: true, signal: interactionAbortController.signal });
    });
    if (inlineOrderPhotoAction) return;

    const selected = inlineOrderMoveElement();
    if (inlineOrderMove && !selected) inlineOrderMove = null;
    if (inlineOrderMove && selected) {
        selected.classList.add('dev-order-move-selected');
        const frame = document.createElement('span');
        frame.className = 'dev-order-move-frame';
        const badge = document.createElement('span');
        badge.className = 'dev-order-move-badge';
        badge.textContent = inlineOrderMoveLabels[inlineOrderMove.level];
        frame.appendChild(badge);
        selected.appendChild(frame);
    }

    blocks.forEach((block) => {
        const { signal } = interactionAbortController;
        block.addEventListener('pointermove', (event) => {
            showInlineOrderDropIndicator(resolveInlineOrderDrop(event, block));
        }, { signal });
        block.addEventListener('pointerleave', () => showInlineOrderDropIndicator(null), { signal });
        block.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            if (activeInlineBlockAction) return;
            if (target.closest('button, input, textarea, .tag-link, .dev-page-inline-add-zone')) return;
            const wrapper = target.closest<HTMLElement>('.photo-wrapper');
            const photoName = wrapper ? inlineOrderPhotoName(wrapper) : '';
            const isText = block.dataset.devBlock === 'text';
            if (!inlineOrderMove && !photoName && !isText) return;
            event.preventDefault();
            event.stopPropagation();
            clearActiveInlineBlockAction();
            const blockKey = inlineOrderBlockKey(block);
            const current = inlineOrderMove;

            if (!current) {
                inlineOrderMove = photoName ? { level: 'photo', photoName, blockKey } : { level: 'block', blockKey };
                initInlineOrderEditor();
                return;
            }
            // Clicking inside the selection widens it: photo -> column -> block -> none.
            if (inlineOrderMoveElement()?.contains(target)) {
                if (current.level === 'photo' && wrapper && inlineOrderColumnOf(wrapper)) {
                    inlineOrderMove = { ...current, level: 'column' };
                } else {
                    inlineOrderMove = current.level === 'block' ? null : { level: 'block', blockKey };
                }
                showInlineOrderDropIndicator(null);
                initInlineOrderEditor();
                return;
            }
            const drop = resolveInlineOrderDrop(event, block);
            if (drop) void moveInlineOrderSelection(drop);
        }, { capture: true, signal });
    });
}

function createPageManagerDialog() {
    let existing = document.getElementById("dev-pm-dialog") as HTMLDialogElement;
    if (existing) return existing;

    const dialog = document.createElement("dialog");
    dialog.id = "dev-pm-dialog";
    dialog.innerHTML = `
        <div style="display: flex; flex-direction: column; height: 80vh; max-height: 800px; width: 600px; max-width: 90vw; background: white; border-radius: 12px; overflow: hidden; font-family: sans-serif;">
            <div style="padding: 1rem 1.5rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #fafafa;">
                <h3 style="margin: 0; font-size: 1rem; color: #333;">Edit order</h3>
                <div class="dev-manager-header-actions">
                    <button id="dev-pm-rename" class="dev-manager-header-button" type="button" title="Rename photos by current order" aria-label="Rename photos by current order">${ICONS.rename}</button>
                    <button id="dev-pm-confirm" class="dev-manager-header-button dev-manager-header-button--save" type="button" title="No pending changes" aria-label="Save Changes" disabled>${ICONS.check}</button>
                    <button id="dev-pm-close" class="dev-manager-header-button" type="button" title="Close" aria-label="Close">${ICONS.close}</button>
                </div>
            </div>
            <div id="dev-pm-content" style="flex: 1; overflow-y: auto; padding: 1.5rem;">
                <div id="dev-pm-tree" class="dev-pm-tree"></div>
            </div>
        </div>
    `;
    dialog.style.cssText = `
        border: none; border-radius: 12px; padding: 0;
        box-shadow: 0 20px 50px rgba(0,0,0,0.3);
        overflow: visible;
    `;
    document.body.appendChild(dialog);
    return dialog;
}

async function openPageManager(keepOrderModeOnClose = false) {
    const albumSlug = getAlbumSlug();
    if (!albumSlug) return showToast("❌ Cannot identify album");
    if (!canStartEditMode('blocks')) return;

    showToast("⌛ Loading structure...");
    const res = await fetch(`/api/get-page-structure?albumSlug=${albumSlug}`);
    if (!res.ok) return showToast("❌ Failed to load structure");

    setOrderEditMode(true);

    const data = await res.json();
    const normalizePageBlocks = (blocks: any[]) => JSON.parse(JSON.stringify(blocks)).map((block: any, index: number) => {
        block.props ||= {};
        block.__devKey ||= `persisted-${index}`;
        // Normalize legacy spacing before Page Manager writes a draft.
        if (block.props.mb && !block.props.blockMargin) {
            block.props.blockMargin = block.props.mb;
        }
        delete block.props.mt;
        delete block.props.mb;
        delete block.props.captionMargin;
        return block;
    });
    const serverBlocks = normalizePageBlocks(data.blocks);
    const stagedStructure = pendingLayoutChange?.albumSlug === albumSlug
        ? pendingLayoutChange
        : null;
    const displayedMetadata = stagedStructure?.draft.metadata || data.metadata || {};
    const Tree = (window as any).Sortable ? (window as any).Sortable : await loadSortable();

    const dialog = createPageManagerDialog();
    const treeContainer = dialog.querySelector("#dev-pm-tree") as HTMLElement;
    const closeBtn = dialog.querySelector("#dev-pm-close") as HTMLButtonElement;
    const confirmBtn = dialog.querySelector("#dev-pm-confirm") as HTMLButtonElement;
    const renameBtn = dialog.querySelector("#dev-pm-rename") as HTMLButtonElement;

    renameBtn.addEventListener('click', () => {
        const orderedKeys = currentBlocks.flatMap((b: any) => b.photos.map((p: any) => p.itemKey));
        if (orderedKeys.length === 0) return showToast('⚠️ No photos to rename');
        void openPhotoRenameDryRun(albumSlug, orderedKeys, (renamed) => {
            currentBlocks.forEach((b: any) => {
                b.photos.forEach((p: any) => {
                    const base = p.itemKey.includes('/') ? p.itemKey.split('/').pop()! : p.itemKey;
                    if (renamed[base]) p.itemKey = renamed[base];
                });
            });
            const coverBase = fmData.coverKey.split('/').pop() || fmData.coverKey;
            if (renamed[coverBase]) fmData.coverKey = renamed[coverBase];
            renderTree();
            initialPageSnapshot = pageStateSnapshot();
            updatePageDirtyState();
        });
    });

    const fmData = {
        coverKey: String(data.metadata?.cover?.assetKey || ''),
    };
    const pageManagerMetadata = () => ({
        title: String(displayedMetadata.title || '').trim(),
        info: String(displayedMetadata.info || '').trim(),
        gap: remValueFromInput(remValueForInput(displayedMetadata.gap)),
    });

    let currentBlocks = normalizePageBlocks(stagedStructure?.draft.blocks || serverBlocks);
    let collapsedBlocks: Set<number> = new Set(
        currentBlocks.map((_: any, i: number) => i),
    ); // All collapsed by default
    let selectedPhoto: {bIdx: number, pIdx: number} | null = null;
    let selectedBlock: number | null = null;
    let pendingPageImports: File[] = [...(stagedStructure?.imports || [])];
    const pendingLocalRemovals = new Set<string>(stagedStructure?.draft.removeLocal || []);
    const localPhotos: Array<{ name: string; size: number; modified: string }> = data.localPhotos || [];
    const importObjectUrls = new Map<File, string>();
    const basename = (value: string) => value.replace(/^\/+/, '').split('/').pop() || value;
    const photoPreviewAttributes = (itemKey: string) => {
        const name = basename(itemKey);
        const stagedFile = pendingPageImports.find((file) => file.name === name);
        if (stagedFile) {
            let url = importObjectUrls.get(stagedFile);
            if (!url) {
                url = URL.createObjectURL(stagedFile);
                importObjectUrls.set(stagedFile, url);
            }
            return `src="${url}"`;
        }
        const fullKey = itemKey.includes('/') ? itemKey : `${albumSlug}/${itemKey}`;
        const encodedKey = fullKey.split('/').map(encodeURIComponent).join('/');
        return `src="/r2/${encodedKey}" data-pm-fallback-url="${R2_DOMAIN}/${encodedKey}"`;
    };
    const localCoverName = () => fmData.coverKey.startsWith(`${albumSlug}/`)
        ? basename(fmData.coverKey)
        : '';
    const referencedPhotoNames = () => new Set([
        ...currentBlocks.flatMap((block: any) => (block.photos || []).map((photo: any) => basename(photo.itemKey))),
        ...(localCoverName() ? [localCoverName()] : []),
    ]);
    const initiallyReferencedNames = new Set([
        ...serverBlocks.flatMap((block: any) => (block.photos || []).map((photo: any) => basename(photo.itemKey))),
        ...(data.metadata?.cover?.assetKey?.startsWith(`${albumSlug}/`)
            ? [basename(data.metadata.cover.assetKey)]
            : []),
    ]);
    const localPhotoNames = new Set(localPhotos.map((photo) => photo.name));
    const reconcileRemovedPhotos = () => {
        const referenced = referencedPhotoNames();
        pendingLocalRemovals.clear();
        initiallyReferencedNames.forEach((name) => {
            if (localPhotoNames.has(name) && !referenced.has(name)) pendingLocalRemovals.add(name);
        });
        const retainedImports: File[] = [];
        for (const file of pendingPageImports) {
            if (referenced.has(file.name)) retainedImports.push(file);
            else {
                const url = importObjectUrls.get(file);
                if (url) URL.revokeObjectURL(url);
                importObjectUrls.delete(file);
            }
        }
        pendingPageImports = retainedImports;
    };
    const pageStateSnapshot = () => JSON.stringify({
        metadata: pageManagerMetadata(),
        blocks: currentBlocks,
        imports: pendingPageImports.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
        removeLocal: [...pendingLocalRemovals].sort(),
    });
    const serverPageSnapshot = JSON.stringify({
        metadata: {
            title: String(data.metadata?.title || '').trim(),
            info: String(data.metadata?.info || '').trim(),
            gap: remValueFromInput(remValueForInput(data.metadata?.gap)),
        },
        blocks: serverBlocks,
        imports: [],
        removeLocal: [],
    });
    let initialPageSnapshot = pageStateSnapshot();
    const updatePageDirtyState = () => {
        const dirty = pageStateSnapshot() !== initialPageSnapshot;
        confirmBtn.disabled = !dirty;
        confirmBtn.title = dirty ? 'Add to pending changes' : 'No new changes';
        const hasStagedStructure = pendingLayoutChange?.albumSlug === albumSlug;
        renameBtn.disabled = dirty || hasStagedStructure;
        renameBtn.title = dirty || hasStagedStructure ? 'Save pending page changes before renaming photos' : 'Rename photos by current order';
    };
    dialog.addEventListener('input', updatePageDirtyState);

    const handlePhotoClick = (bIdx: number, pIdx: number, insertAfter = false) => {
        if (!selectedPhoto) {
            selectedPhoto = {bIdx, pIdx};
            renderTree();
            return;
        }
        if (selectedPhoto.bIdx === bIdx && selectedPhoto.pIdx === pIdx) {
            selectedPhoto = null;
            renderTree();
            return;
        }
        // Move selected photo to before/after the clicked position
        const from = selectedPhoto;
        selectedPhoto = null;
        const previousSpecial = specialBoundaryBlocks();
        const [moved] = currentBlocks[from.bIdx].photos.splice(from.pIdx, 1);
        let targetPIdx = insertAfter ? pIdx + 1 : pIdx;
        if (from.bIdx === bIdx && from.pIdx < targetPIdx) targetPIdx--;
        currentBlocks[bIdx].photos.splice(targetPIdx, 0, moved);
        if (currentBlocks[from.bIdx].photos.length === 0) {
            currentBlocks.splice(from.bIdx, 1);
            syncManagedSpecialMargins(previousSpecial);
        }
        renderTree();
    };

    const moveSelectedBlockToGap = (gapIndex: number) => {
        if (selectedBlock === null) return;
        const from = selectedBlock;
        const collapsedFlags: boolean[] = currentBlocks.map((_: any, index: number) => collapsedBlocks.has(index));
        const previousSpecial = specialBoundaryBlocks();
        const [movedBlock] = currentBlocks.splice(from, 1);
        const [movedCollapsed] = collapsedFlags.splice(from, 1);
        const target = from < gapIndex ? gapIndex - 1 : gapIndex;
        currentBlocks.splice(target, 0, movedBlock);
        collapsedFlags.splice(target, 0, movedCollapsed);
        syncManagedSpecialMargins(previousSpecial);
        collapsedBlocks = new Set(collapsedFlags.flatMap((value: boolean, index: number) => value ? [index] : []));
        selectedBlock = null;
        renderTree();
    };

    const boundaryIsSpecial = (index: number) => {
        const block = currentBlocks[index];
        const nextBlock = currentBlocks[index + 1];
        if (!block) return false;
        if (block.type === 'Text' || isCarouselLikeType(block.type)) return true;
        if (isCarouselLikeType(nextBlock?.type)) return true;

        const captionPosition = String(block.props?.captionPosition || 'center bottom');
        if (block.props?.caption && captionPosition.includes('bottom') && nextBlock) return true;
        const nextCaptionPosition = String(nextBlock?.props?.captionPosition || 'center bottom');
        return Boolean(nextBlock?.props?.caption && nextCaptionPosition.includes('top'));
    };

    // Snapshot taken before a layout edit, keyed by block object.
    const specialBoundaryBlocks = () => new Set(
        currentBlocks.filter((_: any, index: number) => boundaryIsSpecial(index)),
    );

    // Only boundaries whose special status changed are touched, so a
    // margin the user set on an unchanged boundary is preserved.
    const syncManagedSpecialMargins = (previousSpecial: Set<any>) => {
        currentBlocks.forEach((block: any, index: number) => {
            const isSpecial = boundaryIsSpecial(index);
            if (previousSpecial.has(block) === isSpecial) return;
            block.props ||= {};
            const currentMargin = remValueFromInput(block.props.blockMargin || block.props.mb);
            if (isSpecial) {
                if (!currentMargin || currentMargin === '0.5rem') {
                    block.props.blockMargin = '1.5rem';
                    delete block.props.mb;
                }
                return;
            }
            if (currentMargin === '0.5rem' || currentMargin === '1.5rem') {
                delete block.props.blockMargin;
                delete block.props.mb;
            }
        });
    };

    const renderTree = () => {
        sortableInstances.forEach(s => s.destroy());
        sortableInstances.length = 0;

        treeContainer.innerHTML = '';
        reconcileRemovedPhotos();
        const gapSelectionMode = selectedBlock !== null;
        const gapButtonIcon = ICONS.arrowRight;
        currentBlocks.forEach((block: any, bIdx: number) => {
            const isCollapsed = collapsedBlocks.has(bIdx);
            const blockEl = document.createElement('div');
            blockEl.className = `dev-pm-block ${isCollapsed ? 'collapsed' : ''}`;
            blockEl.dataset.idx = bIdx.toString();
            blockEl.innerHTML = `
                <div class="dev-pm-block-header">
                    <button class="block-expander" style="background: none; border: none; cursor: pointer; color: #666; padding: 4px; display: flex; align-items: center; transition: transform 0.2s; ${isCollapsed ? '' : 'transform: rotate(90deg);'}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                    ${selectedBlock === bIdx
                        ? `<button class="block-drag-handle selected" title="Cancel move">${ICONS.drag}</button>`
                        : `<button class="block-drag-handle" title="Click to move / drag">${ICONS.drag}</button>`
                    }
                    <span class="block-type-badge" title="${block.type}">${block.type === 'PhotoPanorama' ? 'P' : block.type === 'PhotoCarousel' ? 'C' : block.type === 'Text' ? 'T' : 'R'}</span>
                    ${isCollapsed && block.type === 'Text' && block.text ? `
                    <div style="flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 0.75rem; color: #64748b; padding: 0 0.25rem; ${block.props.size === 'title' ? 'font-weight: 700;' : ''}">${block.text}</div>
                    ` : isCollapsed && block.type !== 'Text' && isLocalhost && block.photos.length > 0 ? `
                    <div class="dev-pm-thumb-strip">
                        ${block.photos.map((p: any, pIdx: number) => {
                            const isSel = selectedPhoto?.bIdx === bIdx && selectedPhoto?.pIdx === pIdx;
                            const isTarget = selectedPhoto && !(selectedPhoto.bIdx === bIdx && selectedPhoto.pIdx === pIdx);
                            return `<img ${photoPreviewAttributes(p.itemKey)} loading="lazy" title="${p.itemKey.split('/').pop()}" data-bidx="${bIdx}" data-pidx="${pIdx}" class="pm-thumb-click${isSel ? ' pm-photo-selected' : ''}${isTarget ? ' pm-move-target' : ''}" style="cursor:${selectedPhoto ? 'copy' : 'pointer'};${isSel ? 'outline:2px solid #2563eb;outline-offset:1px;opacity:1;' : ''}" />`;
                        }).join('')}
                    </div>` : '<div style="flex:1;"></div>'}
                </div>
                <div class="dev-pm-block-content" style="display: ${isCollapsed ? 'none' : 'block'}; padding-left: 1rem;">
                    ${block.type === 'Text' ? (() => {
                        return `
                            <div style="padding:0.5rem 0;color:#64748b;font-size:0.8rem;line-height:1.45;white-space:pre-wrap;">${escapeHtml(block.text || '')}</div>
                        `;
                    })() : (() => {
                        return `
                            ${block.type === 'PhotoPanorama' ? `
                                ${block.photos.length === 1 ? `
                                    <label style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:0 0 .6rem;color:#64748b;font-size:.75rem;">
                                        Display slices
                                        <input class="photo-panorama-slices" type="number" min="1" max="24" step="1" inputmode="numeric" value="${Math.min(24, Math.max(1, Math.trunc(Number(block.props.panoramaSlices) || 1)))}" style="width:4rem;border:1px solid #cbd5e1;border-radius:4px;background:white;color:#334155;padding:.2rem .35rem;font-size:.75rem;text-align:right;" />
                                    </label>
                                ` : ''}
                            ` : ''}
                            <div class="dev-pm-photo-list" data-block-idx="${bIdx}">
                                ${block.photos.map((p: any, pIdx: number) => `
                                    <div class="dev-pm-photo${selectedPhoto && !(selectedPhoto.bIdx === bIdx && selectedPhoto.pIdx === pIdx) ? ' pm-move-target' : ''}${selectedPhoto?.bIdx === bIdx && selectedPhoto?.pIdx === pIdx ? ' pm-photo-selected' : ''}" data-p-idx="${pIdx}">
                                        <span style="color: #999;">${ICONS.drag}</span>
                                        ${isLocalhost ? `<img ${photoPreviewAttributes(p.itemKey)} loading="lazy" style="width:40px;height:30px;object-fit:cover;border-radius:3px;flex-shrink:0;" />` : ''}
                                        <span style="flex: 1;">${p.itemKey.split('/').pop()}</span>
                                        ${isCarouselLikeType(block.type) || block.photos.length > 1 ? `<div style="position: relative;">
                                            <button class="photo-menu-trigger dev-pm-photo-menu-btn" title="Options">${ICONS.dots}</button>
                                            <div class="dev-pm-photo-menu">
                                                ${block.photos.length > 1 ? `
                                                <div class="dev-pm-photo-menu-item split-btn">
                                                    ${ICONS.split} Extract to own block
                                                </div>` : ''}
                                            </div>
                                        </div>` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        `;
                    })()}
                </div>
                ${gapSelectionMode && bIdx === 0
                    ? `<div class="dev-pm-inline-add-zone dev-pm-inline-add-zone--before is-active"><button class="dev-pm-inline-add-button" type="button" data-page-gap-index="0" title="Move here">${gapButtonIcon}</button></div>`
                    : ''}
                ${gapSelectionMode ? `<div class="dev-pm-inline-add-zone is-active"><button class="dev-pm-inline-add-button" type="button" data-page-gap-index="${bIdx + 1}" title="Move here">${gapButtonIcon}</button></div>` : ''}
            `;

            blockEl.querySelectorAll<HTMLImageElement>('img[data-pm-fallback-url]').forEach((image) => {
                const useFallback = () => {
                    const fallbackUrl = image.dataset.pmFallbackUrl;
                    if (!fallbackUrl) return;
                    delete image.dataset.pmFallbackUrl;
                    image.src = fallbackUrl;
                };
                image.addEventListener('error', useFallback, { once: true });
                if (image.complete && image.naturalWidth === 0) useFallback();
            });

            // Block events
            blockEl.querySelectorAll<HTMLElement>('[data-page-gap-index]').forEach((button) => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const gapIndex = Number(button.dataset.pageGapIndex);
                    if (selectedBlock !== null) moveSelectedBlockToGap(gapIndex);
                });
            });

            blockEl.querySelector('.block-drag-handle')?.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedBlock = selectedBlock === bIdx ? null : bIdx;
                renderTree();
            });

            blockEl.querySelector('.block-expander')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (collapsedBlocks.has(bIdx)) collapsedBlocks.delete(bIdx);
                else {
                    collapsedBlocks.add(bIdx);
                }
                renderTree();
            });

            blockEl.querySelector<HTMLInputElement>('.photo-panorama-slices')?.addEventListener('change', (event) => {
                const input = event.currentTarget as HTMLInputElement;
                const slices = Math.min(24, Math.max(1, Math.trunc(Number(input.value) || 1)));
                input.value = String(slices);
                if (slices > 1) block.props.panoramaSlices = slices;
                else delete block.props.panoramaSlices;
                updatePageDirtyState();
            });
            blockEl.querySelectorAll('.dev-pm-photo').forEach((photoEl, pIdx) => {
                const pMenuTrigger = photoEl.querySelector('.photo-menu-trigger');
                const pMenu = photoEl.querySelector('.dev-pm-photo-menu');

                photoEl.addEventListener('click', (e) => {
                    if ((e.target as HTMLElement).closest('.photo-menu-trigger, .dev-pm-photo-menu')) return;
                    e.stopPropagation();
                    handlePhotoClick(bIdx, pIdx, false);
                });

                photoEl.addEventListener('contextmenu', (e) => {
                    if (!selectedPhoto) return;
                    e.preventDefault();
                    e.stopPropagation();
                    handlePhotoClick(bIdx, pIdx, true);
                });

                pMenuTrigger?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Close other menus
                    document.querySelectorAll('.dev-pm-photo-menu.active').forEach(m => {
                        if (m !== pMenu) m.classList.remove('active');
                    });
                    pMenu?.classList.toggle('active');
                });

                photoEl.querySelector('.split-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const [extracted] = block.photos.splice(pIdx, 1);
                    if (block.photos.length === 0) {
                        // Replace the now-empty block
                        currentBlocks.splice(bIdx, 1, {
                            type: 'Row',
                            __devKey: block.__devKey,
                            props: {},
                            photos: [extracted],
                        });
                    } else {
                        currentBlocks.splice(bIdx + 1, 0, {
                            type: 'Row',
                            __devKey: `pending-${crypto.randomUUID()}`,
                            props: {},
                            photos: [extracted],
                        });
                    }
                    renderTree();
                });

            });

            // Thumb strip click-to-move
            blockEl.querySelectorAll('.pm-thumb-click').forEach((img) => {
                img.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const bi = parseInt((img as HTMLElement).dataset.bidx || '0');
                    const pi = parseInt((img as HTMLElement).dataset.pidx || '0');
                    handlePhotoClick(bi, pi, false);
                });
                img.addEventListener('contextmenu', (e) => {
                    if (!selectedPhoto) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const bi = parseInt((img as HTMLElement).dataset.bidx || '0');
                    const pi = parseInt((img as HTMLElement).dataset.pidx || '0');
                    handlePhotoClick(bi, pi, true);
                });
            });

            treeContainer.appendChild(blockEl);
        });

        // Init Sortable for nested photos
        treeContainer.querySelectorAll('.dev-pm-photo-list').forEach((el) => {
            const s = new Tree(el, {
                group: 'photos',
                animation: 150,
                ghostClass: 'dev-pm-ghost',
                draggable: '.dev-pm-photo',
                onEnd: (evt: any) => {
                    const fromIdx = parseInt(evt.from.dataset.blockIdx);
                    const toIdx = parseInt(evt.to.dataset.blockIdx);
                    if (fromIdx === toIdx && evt.oldIndex === evt.newIndex) return;

                    const previousSpecial = specialBoundaryBlocks();
                    const [moved] = currentBlocks[fromIdx].photos.splice(evt.oldIndex, 1);
                    currentBlocks[toIdx].photos.splice(evt.newIndex, 0, moved);

                    if (currentBlocks[fromIdx].photos.length === 0) {
                        currentBlocks.splice(fromIdx, 1);
                    }
                    syncManagedSpecialMargins(previousSpecial);
                    renderTree();
                }
            });
            sortableInstances.push(s);
        });

        // Init Sortable for blocks
        const sBlocks = new Tree(treeContainer, {
            animation: 150,
            ghostClass: 'dev-pm-ghost',
            draggable: '.dev-pm-block',
            handle: '.dev-pm-block-header',
            onEnd: (evt: any) => {
                if (evt.from !== treeContainer || evt.to !== treeContainer) return;
                const previousSpecial = specialBoundaryBlocks();
                const [moved] = currentBlocks.splice(evt.oldIndex, 1);
                currentBlocks.splice(evt.newIndex, 0, moved);
                syncManagedSpecialMargins(previousSpecial);
                updatePageDirtyState();
            }
        });
        sortableInstances.push(sBlocks);
        updatePageDirtyState();
    };

    const globalClickHandler = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest('.dev-pm-photo-menu-btn')) {
            document.querySelectorAll('.dev-pm-photo-menu.active').forEach(m => m.classList.remove('active'));
        }
        // Deselect if clicking outside any photo
        if (selectedPhoto && !(e.target as HTMLElement).closest('.dev-pm-photo, .pm-thumb-click')) {
            selectedPhoto = null;
            renderTree();
        }
    };
    const pageManagerKeydownHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            if (selectedPhoto) { selectedPhoto = null; renderTree(); }
            else if (selectedBlock !== null) { selectedBlock = null; renderTree(); }
        }
    };
    document.addEventListener('keydown', pageManagerKeydownHandler);
    document.addEventListener('click', globalClickHandler);

    const closeDialog = () => {
        dialog.close();
        if (!keepOrderModeOnClose) setOrderEditMode(false);
        document.removeEventListener('click', globalClickHandler);
        document.removeEventListener('keydown', pageManagerKeydownHandler);
        closeBtn.removeEventListener('click', closeHandler);
        confirmBtn.removeEventListener('click', confirmHandler);
        importObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        importObjectUrls.clear();
        dialog.remove();
    };

    const closeHandler = () => {
        if (!confirmBtn.disabled && !confirm('Discard unstaged order changes?')) return;
        closeDialog();
    };

    const confirmHandler = () => {
        reconcileRemovedPhotos();
        const blocksToSave = currentBlocks;
        const draft: PageStructureDraft = {
            blocks: blocksToSave,
            metadata: {
                title: pageManagerMetadata().title,
                info: pageManagerMetadata().info || undefined,
                gap: pageManagerMetadata().gap || undefined,
            },
            removeLocal: [...pendingLocalRemovals].sort(),
        };
        const stagedSnapshot = JSON.stringify({
            metadata: {
                title: draft.metadata.title,
                info: draft.metadata.info || '',
                gap: draft.metadata.gap || '',
            },
            blocks: draft.blocks,
            imports: pendingPageImports.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
            removeLocal: draft.removeLocal,
        });
        if (stagedSnapshot === serverPageSnapshot) {
            pendingLayoutChange = null;
            renderPendingPageStructure(albumSlug, {
                blocks: serverBlocks,
                metadata: {
                    title: String(data.metadata?.title || ''),
                    info: data.metadata?.info || undefined,
                    gap: data.metadata?.gap || undefined,
                },
                removeLocal: [],
            }, []);
            showToast('ℹ️ Page structure unchanged');
        } else {
            pendingLayoutChange = {
                albumSlug,
                draft: JSON.parse(JSON.stringify(draft)),
                imports: [...pendingPageImports],
            };
            renderPendingPageStructure(albumSlug, pendingLayoutChange.draft, pendingLayoutChange.imports);
            showToast('📝 Pending page structure update');
        }
        updateSaveButtonState();
        closeDialog();
    };

    closeBtn.addEventListener('click', closeHandler);
    confirmBtn.addEventListener('click', confirmHandler);

    renderTree();
    dialog.showModal();
}

const performTagging = async (e: MouseEvent, wrapper: HTMLElement) => {
    const img = wrapper.querySelector('img');
    if (!img) return;

    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const photoId = getPhotoIdFromWrapper(wrapper);
    if (!photoId) return;

    const res = await showTagDialog({
        title: "Add Tag Point",
        photoId, x, y, showDelete: false
    });

    if (res.action === 'save' && res.name) {
        const photoKey = getTagKeyFromPhotoId(photoId);
        currentAlbumTagMap = addOrUpdateTag(currentAlbumTagMap, photoKey, { name: res.name, x, y });
        rememberMountainName(res.name, res.region);
        renderTagOverlaysForPhoto(photoId);
        showToast(`📝 Pending addition: "${res.name}"`);
    }
};

const pasteCopiedTagAtPointer = (e: MouseEvent, wrapper: HTMLElement) => {
    if (!copiedTagName) return false;
    const img = wrapper.querySelector('img');
    const photoId = getPhotoIdFromWrapper(wrapper);
    if (!img || !photoId) return false;

    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const photoKey = getTagKeyFromPhotoId(photoId);
    currentAlbumTagMap = addOrUpdateTag(currentAlbumTagMap, photoKey, {
        name: copiedTagName,
        x,
        y,
    });
    renderTagOverlaysForPhoto(photoId);
    showToast(`📋 Pasted "${copiedTagName}"`);
    return true;
};

const initTagEditButtons = () => {
    document.querySelectorAll('.tag-link').forEach((link) => {
        const nameSpan = link.querySelector('.tag-name') as HTMLElement;
        if (!nameSpan) return;

        if (nameSpan.querySelector('.dev-tag-edit-btn')) return;

        const editBtn = document.createElement('div');
        editBtn.className = 'dev-tag-edit-btn';
        editBtn.innerHTML = ICONS.pencil;

        editBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const wrapper = link.closest('.photo-wrapper') as HTMLElement;
            const photoId = wrapper ? getPhotoIdFromWrapper(wrapper) : '';
            const oldName = nameSpan.dataset.name || "";
            const oldX = parseFloat(nameSpan.dataset.x || "0");
            const oldY = parseFloat(nameSpan.dataset.y || "0");

            if (!photoId) return;

            const res = await showTagDialog({
                title: "Edit Tag",
                photoId, x: oldX, y: oldY, initialName: oldName, showDelete: true
            });

            if (res.action === 'cancel') return;

            const photoKey = getTagKeyFromPhotoId(photoId);
            const previousTag = { name: oldName, x: oldX, y: oldY };

            if (res.action === 'delete') {
                currentAlbumTagMap = removeTagFromMap(currentAlbumTagMap, photoKey, previousTag);
                renderTagOverlaysForPhoto(photoId);
                showToast(`📝 Pending deletion: "${oldName}"`);
                return;
            }

            if (res.action === 'save' && res.name) {
                currentAlbumTagMap = addOrUpdateTag(
                    currentAlbumTagMap,
                    photoKey,
                    { name: res.name, x: oldX, y: oldY },
                    previousTag,
                );
                rememberMountainName(res.name, res.region);
                renderTagOverlaysForPhoto(photoId);
                showToast(`📝 Pending update: "${res.name}"`);
            }
        });

        nameSpan.appendChild(editBtn);
    });
};

const setGlobalTagMode = (enabled: boolean) => {
    activeTagMode = enabled;
    document.querySelectorAll<HTMLElement>('[data-dev-block]').forEach((block) => {
        block.classList.toggle('dev-tag-mode', enabled);
    });
    const tagToggle = document.getElementById('dev-tag-toggle');
    tagToggle?.classList.toggle('active', enabled);
    tagToggle?.setAttribute('aria-pressed', String(enabled));
    updateInlineFocusedActionState();
    updateGlobalTagPendingIndicator();
    updateEditModeAvailability();
};

let activeOrderMode = false;

const updateEditModeAvailability = (isSaving = pendingSaveInProgress) => {
    ['dev-save-btn', 'dev-tag-toggle'].forEach((id) => {
        const control = document.getElementById(id);
        if (!control) return;
        control.classList.remove('dev-edit-mode-hidden');
        control.classList.toggle('dev-edit-mode-unavailable', isSaving);
        control.setAttribute('aria-hidden', 'false');
        control.setAttribute('aria-disabled', String(isSaving));
        if (control instanceof HTMLButtonElement) control.disabled = isSaving;
    });
};

const setOrderEditMode = (enabled: boolean) => {
    activeOrderMode = enabled;
    if (!enabled) {
        inlineOrderPhotoAction = null;
        inlineOrderSelectedPhotoNames.clear();
        inlineOrderLastSelectedPhotoName = null;
        inlineOrderMove = null;
    }
    updateEditModeAvailability();
    initInlineOrderEditor();
};

const setBlockEditMode = (enabled: boolean) => {
    activeBlockEditMode = enabled;
    document.documentElement.classList.toggle('dev-block-edit-mode', enabled);
    if (!enabled) {
        pendingTextBlockEditorKey = null;
        closeAlbumMetadataEditor();
        document.querySelector<HTMLElement>('.dev-album-metadata-editor')?.remove();
        document.querySelectorAll<HTMLElement>('.dev-block-toolbar.is-open').forEach((toolbar) => {
            toolbar.classList.remove('is-open');
            toolbar.querySelectorAll<HTMLElement>('.dev-toolbar-btn.active').forEach((button) => button.classList.remove('active'));
            toolbar.querySelectorAll<HTMLButtonElement>('[aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
        });
    } else {
        initAlbumMetadataEditor();
    }
    const saveBtn = document.getElementById('dev-save-btn');
    saveBtn?.classList.toggle('active', enabled && !hasPendingBlockChanges());
    saveBtn?.setAttribute('aria-pressed', String(enabled));
    updateSaveButtonState();
};

const setLayoutEditMode = (enabled: boolean) => {
    setBlockEditMode(enabled);
    setOrderEditMode(enabled);
};

function closeOtherPageEditors(except?: HTMLElement) {
    const keepLayoutEditMode = Boolean(
        activeBlockEditMode
        && (except?.closest('[data-dev-block]') || except?.matches('[data-dev-album-metadata-edit]')),
    );
    document.querySelector('.dev-page-inline-add-menu')?.remove();
    clearActiveInlineBlockAction();
    if (except?.closest('[data-dev-block]')) clearInlineOrderInteraction();
    setGlobalTagMode(false);
    if (!keepLayoutEditMode) setLayoutEditMode(false);
    if (!except?.matches('[data-dev-album-metadata-edit]')) closeAlbumMetadataEditor();

    document.querySelectorAll<HTMLElement>('.dev-inline-caption-editor').forEach((editor) => {
        editor.remove();
        const block = editor.closest<HTMLElement>('[data-dev-block]');
        block?.querySelectorAll<HTMLElement>(':scope > .photo-caption').forEach((caption) => {
            caption.classList.remove('dev-caption-preview-hidden');
        });
    });
    document.querySelectorAll<HTMLElement>('.dev-inline-text-editor').forEach((editor) => {
        const block = editor.closest<HTMLElement>('[data-dev-block]');
        editor.remove();
        const text = block?.querySelector<HTMLElement>(':scope > .text-block__content');
        text?.classList.toggle('dev-text-preview-hidden', Boolean(block?.classList.contains('dev-text-pending-delete')));
    });
    document.querySelectorAll<HTMLElement>('.dev-block-toolbar.is-open').forEach((toolbar) => {
        toolbar.classList.remove('is-open');
        toolbar.querySelectorAll<HTMLElement>('.dev-toolbar-btn.active').forEach((button) => button.classList.remove('active'));
        toolbar.querySelectorAll<HTMLButtonElement>('[aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
    });
    document.querySelectorAll<HTMLElement>('.dev-inline-margin-control.is-open').forEach((control) => {
        if (control === except || (except && control.contains(except))) return;
        const input = control.querySelector<HTMLInputElement>('.dev-inline-margin-input');
        if (input) {
            input.value = control.dataset.marginValue || input.value;
            input.readOnly = true;
        }
        control.classList.remove('is-open');
        if (activeMarginControl === control) activeMarginControl = null;
    });
    document.querySelectorAll<HTMLElement>('.dev-inline-block-type-control.is-open').forEach((control) => {
        if (control === except || (except && control.contains(except))) return;
        control.classList.remove('is-open');
        control.querySelector('.dev-inline-block-type-current')?.setAttribute('aria-expanded', 'false');
    });
}

const initToolbars = async () => {
    const albumSlug = getAlbumSlug();
    if (!albumSlug) return;

    let sourceBlocks: any[] = [];
    const stagedStructure = pendingLayoutChange?.albumSlug === albumSlug
        ? pendingLayoutChange
        : null;
    if (stagedStructure) {
        sourceBlocks = stagedStructure.draft.blocks;
    } else {
        try {
            const response = await fetch(`/api/get-page-structure?albumSlug=${encodeURIComponent(albumSlug)}`);
            if (response.ok) sourceBlocks = (await response.json()).blocks || [];
        } catch {}
    }

    const blocks = Array.from(document.querySelectorAll('[data-dev-block]'));
    const reconcileAutomaticBlockMargins = () => {
        const currentBlocks = Array.from(document.querySelectorAll<HTMLElement>('[data-dev-block]'));

        const collectRequiredBoundaries = (includePending: boolean) => {
            const required = new Set<number>();
            currentBlocks.forEach((candidate, index) => {
                const sourceType = candidate.dataset.devSourceType;
                const typeChangeKey = candidate.dataset.devTypeChangeKey || '';
                const targetType = includePending
                    ? pendingBlockTypeChanges.get(typeChangeKey)?.targetType || sourceType
                    : sourceType;
                if (targetType === 'Text') required.add(index);
                if (isCarouselLikeType(targetType)) {
                    if (index > 0) required.add(index - 1);
                    required.add(index);
                }

                const captionChangeKey = candidate.dataset.devCaptionChangeKey || '';
                const captionChange = includePending
                    ? pendingCaptionChanges.get(captionChangeKey)
                    : undefined;
                const caption = captionChange
                    ? captionChange.caption
                    : candidate.dataset.devFileCaption || '';
                const captionPosition = captionChange
                    ? captionChange.captionPosition
                    : candidate.dataset.devFileCaptionPos || 'center bottom';
                if (!caption) return;

                const captionIsTop = captionPosition.includes('top');
                const hasAdjacentBlock = captionIsTop
                    ? index > 0
                    : index < currentBlocks.length - 1;
                if (hasAdjacentBlock) required.add(captionIsTop ? index - 1 : index);
            });
            return required;
        };

        const sourceBoundaries = collectRequiredBoundaries(false);
        const pendingBoundaries = collectRequiredBoundaries(true);

        currentBlocks.forEach((candidate) => {
            candidate.dispatchEvent(new CustomEvent('dev:automatic-block-margin', {
                detail: { action: 'reset' },
            }));
        });
        for (const [key, change] of pendingBlockMarginChanges) {
            if (change.automaticSpacingKey) pendingBlockMarginChanges.delete(key);
        }

        const boundaryIndexes = new Set([...sourceBoundaries, ...pendingBoundaries]);
        for (const index of boundaryIndexes) {
            const wasRequired = sourceBoundaries.has(index);
            const isRequired = pendingBoundaries.has(index);
            if (wasRequired === isRequired) continue;
            currentBlocks[index]?.dispatchEvent(new CustomEvent('dev:automatic-block-margin', {
                detail: {
                    action: isRequired ? 'set' : 'remove',
                    spacingKey: `layout-boundary:${index}`,
                },
            }));
        }
    };

    blocks.forEach((block, blockIndex) => {
        if (block.querySelector('.dev-block-toolbar')) return;

        block.classList.add('dev-block-overlay');

        const toolbar = document.createElement('div');
        const blockElement = block as HTMLElement;
        const isTextBlock = blockElement.dataset.devBlock === 'text';
        const sourceType: MediaBlockType | 'Text' = isTextBlock
            ? 'Text'
            : blockElement.dataset.devBlock !== 'carousel'
              ? 'Row'
              : blockElement.dataset.devPanorama === 'true'
                ? 'PhotoPanorama'
                : 'PhotoCarousel';
        const sourceBlock = sourceBlocks[blockIndex]?.type === sourceType
            ? sourceBlocks[blockIndex]
            : undefined;
        const fileCaption = blockElement.dataset.devCaption || '';
        const fileCaptionPosition = blockElement.dataset.devCaptionPos || 'center bottom';
        const fileCaptionHtml = blockElement.querySelector<HTMLElement>(':scope > .photo-caption')?.innerHTML || '';
        const hasCaption = Boolean(fileCaption);
        const textContent = blockElement.querySelector<HTMLElement>(':scope > .text-block__content');
        const fileText = String(sourceBlock?.text ?? textContent?.textContent ?? '').trim();
        const fileTextAlign = (sourceBlock?.props?.align || blockElement.dataset.devTextAlign || 'center') as 'left' | 'center' | 'right';
        const fileTextType = (sourceBlock?.props?.size || blockElement.dataset.devTextType || 'caption') as 'caption' | 'title';
        const fileTextHtml = textContent?.innerHTML || '';
        const photoNames = Array.from(blockElement.querySelectorAll<HTMLElement>('.photo-wrapper[data-item-key]'))
            .map((photo) => photo.dataset.itemKey?.split('/').pop() || '');
        const captionChangeKey = `${sourceType}:${photoNames.join('\u001f')}`;
        blockElement.dataset.devCaptionChangeKey = captionChangeKey;
        blockElement.dataset.devSourceType = sourceType;
        blockElement.dataset.devFileCaption = fileCaption;
        blockElement.dataset.devFileCaptionPos = fileCaptionPosition;
        const blockKey = blockElement.dataset.devBlockKey || sourceBlock?.__devKey || `persisted-${blockIndex}`;
        blockElement.dataset.devBlockKey = blockKey;
        const textChangeKey = `Text:${blockKey}`;
        const marginChangeKey = `${isTextBlock ? textChangeKey : captionChangeKey}:margin`;
        const typeChangeKey = `${captionChangeKey}:type`;
        blockElement.dataset.devTypeChangeKey = typeChangeKey;
        const stagedBlockTypeChange = pendingBlockTypeChanges.get(typeChangeKey);
        const stagedBlockType = stagedBlockTypeChange?.targetType;
        const displayedBlockType = stagedBlockType || sourceType;
        const mediaBlockLabel = (type: MediaBlockType) =>
            type === 'Row' ? 'row' : type === 'PhotoCarousel' ? 'carousel' : 'panorama';
        const mediaBlockAbbreviation = (type: MediaBlockType) =>
            type === 'Row' ? 'R' : type === 'PhotoCarousel' ? 'C' : 'P';
        const displayedMediaType: MediaBlockType = displayedBlockType === 'Text' ? 'Row' : displayedBlockType;
        const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const marginInPixels = Number.parseFloat(getComputedStyle(blockElement).marginBottom);
        const visibleMargin = `${Math.round(((Number.isFinite(marginInPixels) ? marginInPixels : 0) / rootFontSize) * 1000) / 1000}rem`;
        // The margin the album CSS gives this block without an inline
        // override, e.g. 1.5rem around a Carousel.
        const cssDefaultMargin = () => {
            const inlineMargin = blockElement.style.getPropertyValue('margin-bottom');
            const inlinePriority = blockElement.style.getPropertyPriority('margin-bottom');
            blockElement.style.removeProperty('margin-bottom');
            const pixels = Number.parseFloat(getComputedStyle(blockElement).marginBottom);
            if (inlineMargin) blockElement.style.setProperty('margin-bottom', inlineMargin, inlinePriority);
            return `${Math.round(((Number.isFinite(pixels) ? pixels : 0) / rootFontSize) * 1000) / 1000}rem`;
        };
        const originalBlockMargin = sourceBlock?.props?.blockMargin
            || (isTextBlock ? sourceBlock?.props?.mb : '')
            || blockElement.dataset.devBlockMargin
            || '';
        const textIdentityMatches = (change: PendingTextChange) => (
            change.blockKey
                ? change.blockKey === blockKey
                : change.originalText === fileText
                    && change.originalAlign === fileTextAlign
                    && change.originalTextType === fileTextType
        );
        const findPendingTextEntry = () => {
            const direct = pendingTextChanges.get(textChangeKey);
            if (direct && textIdentityMatches(direct)) {
                return [textChangeKey, direct] as const;
            }
            return [...pendingTextChanges.entries()]
                .filter(([, change]) => textIdentityMatches(change))
                .sort(([, left], [, right]) =>
                    Math.abs(left.blockIndex - blockIndex) - Math.abs(right.blockIndex - blockIndex))[0];
        };
        const marginIdentityMatches = (change: PendingBlockMarginChange) => (
            change.blockKey
                ? change.blockKey === blockKey
                : !isTextBlock
                ? change.sourceType === sourceType
                    && change.photoNames.length === photoNames.length
                    && change.photoNames.every((name, index) => name === photoNames[index])
                : change.sourceType === 'Text'
                    && change.originalText === fileText
                    && change.originalBlockMargin === originalBlockMargin
        );
        const findPendingMarginEntry = () => {
            const direct = pendingBlockMarginChanges.get(marginChangeKey);
            if (direct && marginIdentityMatches(direct)) {
                return [marginChangeKey, direct] as const;
            }
            return [...pendingBlockMarginChanges.entries()]
                .filter(([, change]) => marginIdentityMatches(change))
                .sort(([, left], [, right]) =>
                    Math.abs(left.blockIndex - blockIndex) - Math.abs(right.blockIndex - blockIndex))[0];
        };
        const fileEffectiveMargin = remValueFromInput(remValueForInput(originalBlockMargin || visibleMargin));
        const stagedBlockMargin = findPendingMarginEntry()?.[1].blockMargin || '';
        const initialBlockMargin = stagedBlockMargin || originalBlockMargin || visibleMargin;
        const hasBlockMargin = Boolean(stagedBlockMargin || originalBlockMargin);
        toolbar.className = `dev-block-toolbar${hasCaption ? ' has-caption' : ''}${isTextBlock ? ' has-text' : ''}${hasBlockMargin ? ' has-margin' : ''}`;

        toolbar.innerHTML = `
            ${isTextBlock ? `
                <button class="dev-toolbar-btn dev-btn-text${fileText ? ' has-data' : ''}" type="button" title="Edit Text" aria-label="Edit Text" aria-expanded="false">
                    ${ICONS.quote}
                </button>
            ` : `
                <button class="dev-toolbar-btn dev-btn-caption${hasCaption ? ' has-data' : ''}" type="button" title="${hasCaption ? 'Edit Caption' : 'Add Caption'}" aria-label="${hasCaption ? 'Edit Caption' : 'Add Caption'}" aria-expanded="false">
                    ${ICONS.quote}
                </button>
            `}
            <div class="dev-inline-margin-control${hasBlockMargin ? ' has-data' : ''}" title="Edit block margin">
                <input class="dev-inline-margin-input" type="number" step="0.1" inputmode="decimal" value="${remValueForInput(initialBlockMargin)}" aria-label="Block margin in rem" readonly />
            </div>
            ${isTextBlock ? '' : `
                <div class="dev-inline-block-type-control has-data${stagedBlockTypeChange ? ' has-pending' : ''}">
                    <div class="dev-inline-block-type-options" role="group" aria-label="Choose block type">
                        ${([
                            ['Row', 'row'],
                            ['PhotoCarousel', 'carousel'],
                            ['PhotoPanorama', 'panorama'],
                        ] as const).map(([mode, label]) => `
                            <button class="dev-inline-block-type-option" type="button" data-block-mode="${mode}" title="${mediaBlockLabel(mode)}" aria-label="Use ${mediaBlockLabel(mode)}" aria-pressed="${displayedMediaType === mode}">${label}</button>
                        `).join('')}
                    </div>
                    <button class="dev-inline-block-type-current" type="button" title="Choose block type" aria-label="Choose block type" aria-expanded="false">
                        <span aria-hidden="true">${mediaBlockAbbreviation(displayedMediaType)}</span>
                    </button>
                </div>
            `}
        `;
        block.appendChild(toolbar);

        const captionButton = toolbar.querySelector<HTMLButtonElement>('.dev-btn-caption');
        const textButton = toolbar.querySelector<HTMLButtonElement>('.dev-btn-text');
        const blockTypeControl = toolbar.querySelector<HTMLElement>('.dev-inline-block-type-control');
        const blockTypeButton = toolbar.querySelector<HTMLButtonElement>('.dev-inline-block-type-current');
        const blockTypeOptions = toolbar.querySelectorAll<HTMLButtonElement>('.dev-inline-block-type-option');
        const marginControl = toolbar.querySelector<HTMLElement>('.dev-inline-margin-control')!;
        const marginInput = toolbar.querySelector<HTMLInputElement>('.dev-inline-margin-input')!;

        const updateCaptionPreview = (caption: string, captionPosition: string, matchesFile = false) => {
            const [align = 'center', verticalPosition = 'bottom'] = captionPosition.split(' ');
            let preview = blockElement.querySelector<HTMLElement>(':scope > .photo-caption');
            if (!caption) {
                preview?.remove();
                delete blockElement.dataset.devCaption;
                delete blockElement.dataset.devCaptionPos;
            } else {
                const isGeneratedPreview = !preview
                    || preview.classList.contains('dev-caption-generated-preview');
                if (!preview) {
                    preview = document.createElement('div');
                    preview.classList.add('photo-caption');
                }
                preview.className = `photo-caption ${verticalPosition}`;
                preview.classList.toggle('dev-caption-generated-preview', isGeneratedPreview);
                preview.style.textAlign = align;
                if (matchesFile) preview.innerHTML = fileCaptionHtml;
                else {
                    preview.classList.add('dev-caption-live-preview');
                    preview.textContent = caption;
                }
                blockElement.dataset.devCaption = caption;
                blockElement.dataset.devCaptionPos = captionPosition;
                if (verticalPosition === 'top') {
                    const firstContent = Array.from(blockElement.children)
                        .find((child) => !child.classList.contains('dev-block-toolbar'));
                    if (firstContent) blockElement.insertBefore(preview, firstContent);
                    else blockElement.appendChild(preview);
                } else {
                    blockElement.insertBefore(preview, toolbar);
                }
            }
            const hasCurrentCaption = Boolean(caption);
            toolbar.classList.toggle('has-caption', hasCurrentCaption);
            captionButton?.classList.toggle('has-data', hasCurrentCaption);
            captionButton?.setAttribute('title', hasCurrentCaption ? 'Edit Caption' : 'Add Caption');
            captionButton?.setAttribute('aria-label', hasCurrentCaption ? 'Edit Caption' : 'Add Caption');
        };

        const updateMarginPreview = (blockMargin: string) => {
            if (blockMargin) blockElement.style.setProperty('margin-bottom', blockMargin, 'important');
            else blockElement.style.removeProperty('margin-bottom');
            const effectiveMargin = blockMargin || cssDefaultMargin();
            if (blockMargin) blockElement.dataset.devBlockMargin = blockMargin;
            else delete blockElement.dataset.devBlockMargin;
            const hasCurrentMargin = Boolean(blockMargin);
            toolbar.classList.toggle('has-margin', hasCurrentMargin);
            marginControl.classList.toggle('has-data', hasCurrentMargin);
            marginInput.value = remValueForInput(effectiveMargin);
        };

        const closeInlineMarginEditor = () => {
            marginControl.classList.remove('is-open');
            marginInput.readOnly = true;
            if (activeMarginControl === marginControl) activeMarginControl = null;
        };

        const openInlineMarginEditor = () => {
            if (!canStartEditMode('blocks')) return;
            closeOtherPageEditors(marginControl);
            if (activeMarginControl && activeMarginControl !== marginControl) {
                const previousInput = activeMarginControl.querySelector<HTMLInputElement>('.dev-inline-margin-input');
                if (previousInput) previousInput.value = activeMarginControl.dataset.marginValue || '';
                previousInput && (previousInput.readOnly = true);
                activeMarginControl.classList.remove('is-open');
            }
            activeMarginControl = marginControl;
            marginControl.dataset.marginValue = marginInput.value;
            marginControl.classList.add('is-open');
            marginInput.readOnly = false;
            marginInput.focus();
            marginInput.select();
        };

        const stageBlockMargin = (
            requestedMargin?: string,
            automaticSpacingKey?: string,
            silent = false,
        ) => {
            if (requestedMargin !== undefined) {
                marginInput.value = remValueForInput(requestedMargin);
            }
            const blockMargin = remValueFromInput(marginInput.value);
            const expectedEffectiveMargin = originalBlockMargin
                ? fileEffectiveMargin
                : remValueFromInput(remValueForInput(cssDefaultMargin()));
            const matchesFile = blockMargin === expectedEffectiveMargin;
            const pendingMarginEntry = findPendingMarginEntry();
            const pendingMarginKey = pendingMarginEntry?.[0]
                || (!pendingBlockMarginChanges.has(marginChangeKey)
                    ? marginChangeKey
                    : `${marginChangeKey}:${Date.now()}`);
            if (matchesFile) {
                if (pendingMarginEntry) pendingBlockMarginChanges.delete(pendingMarginEntry[0]);
            } else {
                pendingBlockMarginChanges.set(pendingMarginKey, {
                    sourceType,
                    blockKey,
                    blockIndex,
                    photoNames,
                    blockMargin,
                    originalBlockMargin,
                    originalText: isTextBlock ? fileText : undefined,
                    automaticSpacingKey,
                });
            }
            updateMarginPreview(matchesFile ? originalBlockMargin : blockMargin);
            marginControl.classList.toggle('has-pending', !matchesFile);
            syncToolbarPendingState(toolbar);
            closeInlineMarginEditor();
            updateSaveButtonState();
            if (!silent) {
                showToast(matchesFile ? 'ℹ️ Block margin unchanged' : '📝 Pending block margin update');
            }
        };

        blockElement.addEventListener('dev:automatic-block-margin', (event) => {
            const detail = (event as CustomEvent<{
                action: 'reset' | 'set' | 'remove';
                spacingKey?: string;
            }>).detail;
            const pendingMarginEntry = findPendingMarginEntry();

            if (detail.action === 'reset') {
                if (!pendingMarginEntry?.[1].automaticSpacingKey) return;
                pendingBlockMarginChanges.delete(pendingMarginEntry[0]);
                updateMarginPreview(originalBlockMargin);
                marginControl.classList.remove('has-pending');
                syncToolbarPendingState(toolbar);
                return;
            }

            if (pendingMarginEntry && !pendingMarginEntry[1].automaticSpacingKey) {
                return;
            }
            if (detail.action === 'remove') {
                if (remValueFromInput(originalBlockMargin) === '1.5rem') {
                    stageBlockMargin('', detail.spacingKey, true);
                } else if (!originalBlockMargin) {
                    updateMarginPreview('');
                }
                return;
            }
            if (originalBlockMargin && fileEffectiveMargin !== '0.5rem') return;
            stageBlockMargin('1.5rem', detail.spacingKey, true);
        });

        const updateBlockTypePreview = (
            targetType: MediaBlockType,
            matchesFile: boolean,
        ) => {
            const track = blockElement.querySelector<HTMLElement>(':scope > .photo-row, :scope > .carousel-track, :scope > .photo-panorama-stage > .photo-panorama-track');
            if (!track) return;
            const slides = Array.from(track.children)
                .filter((slide) => !(slide as HTMLElement).dataset.panoramaGeneratedSlice) as HTMLElement[];

            const restoreOriginalLayout = () => {
                blockElement.classList.remove('dev-preview-as-row', 'dev-preview-as-carousel', 'dev-preview-as-panorama');
                blockElement.querySelector('.dev-preview-carousel-dots')?.remove();
                blockElement.querySelector('.dev-preview-panorama-controls')?.remove();
                delete blockElement.dataset.devPreviewPanoramaView;
                slides.forEach((slide) => {
                    if ('devPreviewOriginalFlex' in slide.dataset) {
                        slide.style.flex = slide.dataset.devPreviewOriginalFlex || '';
                        delete slide.dataset.devPreviewOriginalFlex;
                    }
                    if (slide.dataset.devPreviewWasActive === 'true') slide.setAttribute('data-active', '');
                    else if ('devPreviewWasActive' in slide.dataset) slide.removeAttribute('data-active');
                    delete slide.dataset.devPreviewWasActive;
                });
                if ('devPreviewScrollLeft' in track.dataset) {
                    track.scrollLeft = Number(track.dataset.devPreviewScrollLeft) || 0;
                    delete track.dataset.devPreviewScrollLeft;
                }
            };

            if (matchesFile) {
                restoreOriginalLayout();
                updateMarginPreview(findPendingMarginEntry()?.[1].blockMargin || originalBlockMargin);
                return;
            }

            if (!('devPreviewScrollLeft' in track.dataset)) {
                track.dataset.devPreviewScrollLeft = String(track.scrollLeft);
            }
            slides.forEach((slide) => {
                if (!('devPreviewOriginalFlex' in slide.dataset)) {
                    slide.dataset.devPreviewOriginalFlex = slide.style.flex;
                    slide.dataset.devPreviewWasActive = String(slide.hasAttribute('data-active'));
                }
            });

            blockElement.classList.toggle('dev-preview-as-row', targetType === 'Row');
            blockElement.classList.toggle('dev-preview-as-carousel', targetType === 'PhotoCarousel');
            blockElement.classList.toggle('dev-preview-as-panorama', targetType === 'PhotoPanorama');
            blockElement.querySelector('.dev-preview-carousel-dots')?.remove();
            blockElement.querySelector('.dev-preview-panorama-controls')?.remove();
            delete blockElement.dataset.devPreviewPanoramaView;
            updateMarginPreview(findPendingMarginEntry()?.[1].blockMargin || originalBlockMargin);

            if (targetType === 'Row') {
                slides.forEach((slide) => {
                    const image = slide.querySelector<HTMLImageElement>('img');
                    const applyRatio = () => {
                        if (!image?.naturalWidth || !image.naturalHeight) return;
                        slide.style.flex = `${(image.naturalWidth / image.naturalHeight) * 100} 1 0%`;
                    };
                    slide.setAttribute('data-active', '');
                    if (image?.complete) applyRatio();
                    else image?.addEventListener('load', applyRatio, { once: true });
                });
                return;
            }

            slides.forEach((slide, index) => {
                if (index === 0) slide.setAttribute('data-active', '');
                else slide.removeAttribute('data-active');
            });
            track.scrollLeft = 0;
            if (targetType === 'PhotoPanorama') {
                blockElement.dataset.devPreviewPanoramaView = 'carousel';
                slides.forEach((slide) => {
                    const image = slide.querySelector<HTMLImageElement>('img');
                    const applyRatio = () => {
                        if (!image?.naturalWidth || !image.naturalHeight) return;
                        slide.style.setProperty('--panorama-grow', String((image.naturalWidth / image.naturalHeight) * 100));
                    };
                    if (image?.complete) applyRatio();
                    else image?.addEventListener('load', applyRatio, { once: true });
                });

                const controls = document.createElement('div');
                controls.className = 'dev-preview-panorama-controls';
                const panoramaDots = document.createElement('div');
                panoramaDots.className = 'dev-preview-panorama-dots';
                const viewToggle = document.createElement('button');
                viewToggle.className = 'dev-preview-panorama-toggle';
                viewToggle.type = 'button';
                viewToggle.title = 'Switch to Panorama';
                viewToggle.setAttribute('aria-label', viewToggle.title);
                viewToggle.innerHTML = '<span aria-hidden="true">C</span>';

                slides.forEach((slide, index) => {
                    if (slides.length < 2) return;
                    const dot = document.createElement('button');
                    dot.className = `dev-preview-panorama-dot${index === 0 ? ' active' : ''}`;
                    dot.type = 'button';
                    dot.setAttribute('aria-label', `Go to slide ${index + 1}`);
                    dot.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        blockElement.dataset.devPreviewPanoramaView = 'carousel';
                        viewToggle.title = 'Switch to Panorama';
                        viewToggle.setAttribute('aria-label', viewToggle.title);
                        viewToggle.querySelector('span')!.textContent = 'C';
                        slides.forEach((candidate) => candidate.removeAttribute('data-active'));
                        panoramaDots.querySelectorAll('.dev-preview-panorama-dot').forEach((candidate) => candidate.classList.remove('active'));
                        slide.setAttribute('data-active', '');
                        dot.classList.add('active');
                        track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
                    });
                    panoramaDots.appendChild(dot);
                });

                viewToggle.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const panorama = blockElement.dataset.devPreviewPanoramaView !== 'panorama';
                    blockElement.dataset.devPreviewPanoramaView = panorama ? 'panorama' : 'carousel';
                    viewToggle.title = panorama ? 'Switch to Carousel' : 'Switch to Panorama';
                    viewToggle.setAttribute('aria-label', viewToggle.title);
                    viewToggle.querySelector('span')!.textContent = panorama ? 'P' : 'C';
                    track.scrollLeft = 0;
                });
                controls.append(panoramaDots, viewToggle);
                blockElement.insertBefore(controls, blockElement.querySelector(':scope > .photo-caption.bottom, :scope > .dev-block-toolbar'));
                return;
            }

            if (slides.length < 2) return;
            const dots = document.createElement('div');
            dots.className = 'dev-preview-carousel-dots';
            slides.forEach((slide, index) => {
                const dot = document.createElement('button');
                dot.className = `dev-preview-carousel-dot${index === 0 ? ' active' : ''}`;
                dot.type = 'button';
                dot.setAttribute('aria-label', `Go to slide ${index + 1}`);
                dot.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    slides.forEach((candidate) => candidate.removeAttribute('data-active'));
                    dots.querySelectorAll('.dev-preview-carousel-dot').forEach((candidate) => candidate.classList.remove('active'));
                    slide.setAttribute('data-active', '');
                    dot.classList.add('active');
                    track.scrollTo({
                        left: slide.offsetLeft - track.offsetLeft - (track.clientWidth - slide.clientWidth) / 2,
                        behavior: 'smooth',
                    });
                });
                dots.appendChild(dot);
            });
            blockElement.insertBefore(dots, blockElement.querySelector(':scope > .photo-caption.bottom, :scope > .dev-block-toolbar'));
        };

        const closeBlockTypeMenu = () => {
            blockTypeControl?.classList.remove('is-open');
            blockTypeButton?.setAttribute('aria-expanded', 'false');
        };

        const stageBlockType = (targetMode: MediaBlockType) => {
            if (!canStartEditMode('blocks')) return;
            if (isTextBlock || !blockTypeButton || sourceType === 'Text') return;
            const targetType = targetMode;
            const matchesFile = targetType === sourceType;
            if (matchesFile) {
                pendingBlockTypeChanges.delete(typeChangeKey);
            } else {
                pendingBlockTypeChanges.set(typeChangeKey, {
                    sourceType,
                    targetType,
                    blockIndex,
                    photoNames,
                });
            }
            blockTypeButton.querySelector('span')!.textContent = mediaBlockAbbreviation(targetMode);
            blockTypeOptions.forEach((option) => {
                option.setAttribute('aria-pressed', String(option.dataset.blockMode === targetMode));
            });
            blockTypeControl?.classList.toggle('has-pending', !matchesFile);
            closeBlockTypeMenu();
            updateBlockTypePreview(targetMode, matchesFile);
            reconcileAutomaticBlockMargins();
            syncToolbarPendingState(toolbar);
            updateSaveButtonState();
            showToast(matchesFile ? 'ℹ️ Block type unchanged' : `📝 Pending switch to ${mediaBlockLabel(targetMode)}`);
        };

        const closeInlineCaptionEditor = () => {
            blockElement.querySelector('.dev-inline-caption-editor')?.remove();
            blockElement.querySelectorAll(':scope > .photo-caption').forEach((caption) => {
                caption.classList.remove('dev-caption-preview-hidden');
            });
            toolbar.classList.remove('is-open');
            captionButton?.classList.remove('active');
            captionButton?.setAttribute('aria-expanded', 'false');
        };

        const openInlineCaptionEditor = () => {
            if (!canStartEditMode('blocks')) return;
            closeOtherPageEditors(captionButton || undefined);
            closeInlineCaptionEditor();

            const pendingChange = pendingCaptionChanges.get(captionChangeKey);
            const initialCaption = pendingChange?.caption ?? blockElement.dataset.devCaption ?? '';
            const initialPosition = pendingChange?.captionPosition ?? blockElement.dataset.devCaptionPos ?? 'center bottom';
            const [initialAlign = 'center', initialVPos = 'bottom'] = initialPosition.split(' ');
            const editor = document.createElement('div');
            editor.className = 'dev-inline-caption-editor';
            editor.innerHTML = `
                <div class="dev-inline-caption-editor__content">
                    <textarea class="dev-inline-caption-text" rows="4" wrap="soft" placeholder="Caption, **bold**, *italic*, or [text](link)..."></textarea>
                    <div class="dev-inline-caption-editor__side-controls">
                        <div class="dev-inline-caption-editor__actions">
                            ${initialCaption ? `<button class="dev-inline-caption-delete" type="button" title="Delete Caption" aria-label="Delete Caption">${ICONS.trash}</button>` : '<span></span>'}
                            <button class="dev-inline-caption-cancel" type="button" title="Cancel" aria-label="Cancel">${ICONS.close}</button>
                            <button class="dev-inline-caption-save" type="button" title="Save Caption" aria-label="Save Caption">${ICONS.check}</button>
                        </div>
                        <select class="dev-inline-caption-align" aria-label="Caption alignment">
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                        </select>
                        <select class="dev-inline-caption-vpos" aria-label="Caption position">
                            <option value="top">Top</option>
                            <option value="bottom">Bottom</option>
                        </select>
                    </div>
                </div>
            `;

            const textInput = editor.querySelector<HTMLTextAreaElement>('.dev-inline-caption-text')!;
            const alignSelect = editor.querySelector<HTMLSelectElement>('.dev-inline-caption-align')!;
            const positionSelect = editor.querySelector<HTMLSelectElement>('.dev-inline-caption-vpos')!;
            const saveButton = editor.querySelector<HTMLButtonElement>('.dev-inline-caption-save')!;
            textInput.value = initialCaption;
            alignSelect.value = initialAlign;
            positionSelect.value = initialVPos;

            const positionEditor = () => {
                blockElement.querySelectorAll(':scope > .photo-caption').forEach((caption) => {
                    caption.classList.add('dev-caption-preview-hidden');
                });
                const position = positionSelect.value;
                const captionAnchor = blockElement.querySelector(`:scope > .photo-caption.${position}`);
                if (captionAnchor) {
                    blockElement.insertBefore(editor, captionAnchor);
                    return;
                }
                if (position === 'top') {
                    const firstContent = Array.from(blockElement.children)
                        .find((child) => !child.classList.contains('dev-block-toolbar'));
                    if (firstContent) blockElement.insertBefore(editor, firstContent);
                    else blockElement.appendChild(editor);
                    return;
                }
                blockElement.appendChild(editor);
            };

            const stageInlineCaption = (caption: string) => {
                const captionPosition = `${alignSelect.value} ${positionSelect.value}`;
                const matchesFile = caption === fileCaption && captionPosition === fileCaptionPosition;
                if (matchesFile) {
                    pendingCaptionChanges.delete(captionChangeKey);
                } else {
                    pendingCaptionChanges.set(captionChangeKey, {
                        sourceType: sourceType as PendingCaptionChange['sourceType'],
                        blockIndex,
                        photoNames,
                        caption,
                        captionPosition,
                        originalCaption: fileCaption,
                        originalCaptionPosition: fileCaptionPosition,
                    });
                }
                closeInlineCaptionEditor();
                updateCaptionPreview(caption, captionPosition, matchesFile);
                reconcileAutomaticBlockMargins();
                captionButton?.classList.toggle('has-pending', !matchesFile);
                syncToolbarPendingState(toolbar);
                updateSaveButtonState();
                showToast(matchesFile ? 'ℹ️ Caption unchanged' : `📝 Pending caption ${caption ? 'update' : 'deletion'}`);
            };

            editor.querySelector('.dev-inline-caption-cancel')?.addEventListener('click', closeInlineCaptionEditor);
            editor.querySelector('.dev-inline-caption-delete')?.addEventListener('click', () => {
                stageInlineCaption('');
            });
            saveButton.addEventListener('click', () => {
                stageInlineCaption(textInput.value.trim());
            });
            positionSelect.addEventListener('change', positionEditor);
            editor.addEventListener('click', (event) => event.stopPropagation());
            positionEditor();
            toolbar.classList.add('is-open');
            captionButton?.classList.add('active');
            captionButton?.setAttribute('aria-expanded', 'true');
            textInput.focus();
        };

        const closeInlineTextEditor = () => {
            blockElement.querySelector('.dev-inline-text-editor')?.remove();
            const pendingChange = findPendingTextEntry()?.[1];
            textContent?.classList.toggle('dev-text-preview-hidden', Boolean(pendingChange?.deleted));
            toolbar.classList.remove('is-open');
            textButton?.classList.remove('active');
            textButton?.setAttribute('aria-expanded', 'false');
        };

        const updateTextPreview = (
            text: string,
            align: 'left' | 'center' | 'right',
            textType: 'caption' | 'title',
            deleted: boolean,
            matchesFile: boolean,
        ) => {
            if (textContent) {
                if (matchesFile) textContent.innerHTML = fileTextHtml;
                else {
                    textContent.replaceChildren();
                    appendPendingRichText(textContent, text);
                }
                textContent.classList.toggle('dev-text-preview-hidden', deleted);
            }
            blockElement.style.textAlign = align;
            blockElement.classList.toggle('text-block--caption', textType === 'caption');
            blockElement.classList.toggle('text-block--title', textType === 'title');
            blockElement.classList.toggle('dev-text-pending-delete', deleted);
            blockElement.dataset.devTextAlign = align;
            blockElement.dataset.devTextType = textType;
            textButton?.classList.toggle('has-data', !deleted && Boolean(text));
        };

        const openInlineTextEditor = () => {
            if (!canStartEditMode('blocks')) return;
            closeOtherPageEditors(textButton || undefined);
            closeInlineTextEditor();

            const pendingChange = findPendingTextEntry()?.[1];
            const initialText = pendingChange?.text ?? fileText;
            const initialAlign = pendingChange?.align ?? fileTextAlign;
            const initialTextType = pendingChange?.textType ?? fileTextType;
            const editor = document.createElement('div');
            editor.className = 'dev-inline-caption-editor dev-inline-text-editor';
            editor.innerHTML = `
                <div class="dev-inline-caption-editor__content">
                    <textarea class="dev-inline-text-input" rows="4" wrap="soft" placeholder="Text, **bold**, *italic*, or [text](link)..."></textarea>
                    <div class="dev-inline-caption-editor__side-controls">
                        <div class="dev-inline-caption-editor__actions">
                            <button class="dev-inline-text-delete" type="button" title="Delete Text block" aria-label="Delete Text block">${ICONS.trash}</button>
                            <button class="dev-inline-text-cancel" type="button" title="Cancel" aria-label="Cancel">${ICONS.close}</button>
                            <button class="dev-inline-caption-save dev-inline-text-save" type="button" title="Confirm Text change" aria-label="Confirm Text change">${ICONS.check}</button>
                        </div>
                        <select class="dev-inline-text-align" aria-label="Text alignment">
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                        </select>
                        <select class="dev-inline-text-type" aria-label="Text type">
                            <option value="caption">Caption</option>
                            <option value="title">Title</option>
                        </select>
                    </div>
                </div>
            `;

            const textInput = editor.querySelector<HTMLTextAreaElement>('.dev-inline-text-input')!;
            const alignSelect = editor.querySelector<HTMLSelectElement>('.dev-inline-text-align')!;
            const typeSelect = editor.querySelector<HTMLSelectElement>('.dev-inline-text-type')!;
            textInput.value = initialText;
            alignSelect.value = initialAlign;
            typeSelect.value = initialTextType;

            const stageInlineText = (deleted = false) => {
                const text = textInput.value.trim();
                const align = alignSelect.value as 'left' | 'center' | 'right';
                const textType = typeSelect.value as 'caption' | 'title';
                const matchesFile = !deleted
                    && text === fileText
                    && align === fileTextAlign
                    && textType === fileTextType;
                const pendingTextEntry = findPendingTextEntry();
                const pendingTextKey = pendingTextEntry?.[0]
                    || (!pendingTextChanges.has(textChangeKey)
                        ? textChangeKey
                        : `${textChangeKey}:${Date.now()}`);
                if (matchesFile) {
                    if (pendingTextEntry) pendingTextChanges.delete(pendingTextEntry[0]);
                } else {
                    pendingTextChanges.set(pendingTextKey, {
                        sourceType: 'Text',
                        blockKey,
                        blockIndex,
                        text,
                        align,
                        textType,
                        deleted,
                        originalText: fileText,
                        originalAlign: fileTextAlign,
                        originalTextType: fileTextType,
                    });
                }
                closeInlineTextEditor();
                updateTextPreview(text, align, textType, deleted, matchesFile);
                textButton?.classList.toggle('has-pending', !matchesFile);
                syncToolbarPendingState(toolbar);
                updateSaveButtonState();
                showToast(matchesFile ? 'ℹ️ Text unchanged' : `📝 Pending Text ${deleted ? 'block deletion' : 'update'}`);
            };

            editor.querySelector('.dev-inline-text-cancel')?.addEventListener('click', closeInlineTextEditor);
            editor.querySelector('.dev-inline-text-delete')?.addEventListener('click', () => stageInlineText(true));
            editor.querySelector('.dev-inline-text-save')?.addEventListener('click', () => stageInlineText(false));
            editor.addEventListener('click', (event) => event.stopPropagation());
            textContent?.classList.add('dev-text-preview-hidden');
            blockElement.insertBefore(editor, toolbar);
            toolbar.classList.add('is-open');
            textButton?.classList.add('active');
            textButton?.setAttribute('aria-expanded', 'true');
            textInput.focus();
        };

        captionButton?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (blockElement.querySelector('.dev-inline-caption-editor')) closeInlineCaptionEditor();
            else openInlineCaptionEditor();
        });
        textButton?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (blockElement.querySelector('.dev-inline-text-editor')) closeInlineTextEditor();
            else openInlineTextEditor();
        });
        blockElement.addEventListener('dblclick', (event) => {
            const target = event.target as HTMLElement;
            if (isTextBlock) {
                const content = target.closest('.text-block__content');
                if (!content || content.parentElement !== blockElement) return;
                event.preventDefault();
                event.stopPropagation();
                if (!blockElement.querySelector('.dev-inline-text-editor')) openInlineTextEditor();
                return;
            }

            const caption = target.closest('.photo-caption');
            if (!caption || caption.parentElement !== blockElement) return;
            event.preventDefault();
            event.stopPropagation();
            if (!blockElement.querySelector('.dev-inline-caption-editor')) openInlineCaptionEditor();
        });
        marginInput.addEventListener('click', (event) => {
            event.stopPropagation();
            if (marginInput.readOnly) openInlineMarginEditor();
        });
        marginInput.addEventListener('keydown', (event) => {
            if (event.isComposing) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                stageBlockMargin();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                marginInput.value = marginControl.dataset.marginValue || remValueForInput(initialBlockMargin);
                closeInlineMarginEditor();
            }
        });
        blockTypeButton?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const willOpen = !blockTypeControl?.classList.contains('is-open');
            if (willOpen && blockTypeControl) closeOtherPageEditors(blockTypeControl);
            document.querySelectorAll<HTMLElement>('.dev-inline-block-type-control.is-open').forEach((control) => {
                control.classList.remove('is-open');
                control.querySelector('.dev-inline-block-type-current')?.setAttribute('aria-expanded', 'false');
            });
            blockTypeControl?.classList.toggle('is-open', willOpen);
            blockTypeButton.setAttribute('aria-expanded', String(willOpen));
        });
        blockTypeOptions.forEach((option) => {
            option.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                stageBlockType(option.dataset.blockMode as MediaBlockType);
            });
        });

        const stagedCaption = pendingCaptionChanges.get(captionChangeKey);
        if (stagedCaption) {
            updateCaptionPreview(stagedCaption.caption, stagedCaption.captionPosition);
            captionButton?.classList.add('has-pending');
        }
        const stagedText = findPendingTextEntry()?.[1];
        if (stagedText) {
            updateTextPreview(stagedText.text, stagedText.align, stagedText.textType, stagedText.deleted, false);
            textButton?.classList.add('has-pending');
        }
        if (stagedBlockMargin) {
            updateMarginPreview(stagedBlockMargin);
            marginControl.classList.add('has-pending');
        }
        if (stagedBlockTypeChange) {
            updateBlockTypePreview(
                stagedBlockTypeChange.targetType,
                false,
            );
        }
        syncToolbarPendingState(toolbar);

        blockElement.addEventListener('click', (event) => {
            if (!blockElement.classList.contains('dev-preview-as-carousel')) return;
            const track = blockElement.querySelector<HTMLElement>(':scope > .photo-row, :scope > .photo-panorama-stage > .photo-panorama-track');
            const slide = (event.target as HTMLElement).closest<HTMLElement>('.photo-row > *, .photo-panorama-track > *');
            if (!track || !slide || !track.contains(slide) || slide.hasAttribute('data-active')) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            const slides = Array.from(track.children) as HTMLElement[];
            const targetIndex = slides.indexOf(slide);
            slides.forEach((candidate) => candidate.removeAttribute('data-active'));
            slide.setAttribute('data-active', '');
            blockElement.querySelectorAll('.dev-preview-carousel-dot').forEach((dot, index) => {
                dot.classList.toggle('active', index === targetIndex);
            });
            track.scrollTo({
                left: slide.offsetLeft - track.offsetLeft - (track.clientWidth - slide.clientWidth) / 2,
                behavior: 'smooth',
            });
        }, true);

        blockElement.addEventListener('pointerdown', (event) => {
            if (!blockElement.classList.contains('dev-preview-as-row')) return;
            const track = blockElement.querySelector<HTMLElement>(':scope > .carousel-track, :scope > .photo-panorama-stage > .photo-panorama-track');
            const slide = (event.target as HTMLElement).closest<HTMLElement>('.carousel-track > *, .photo-panorama-track > *');
            if (!track || !slide || !track.contains(slide)) return;
            slide.setAttribute('data-active', '');
        }, true);

        if (isTextBlock && pendingTextBlockEditorKey === blockKey) {
            pendingTextBlockEditorKey = null;
            openInlineTextEditor();
        }
    });
    reconcileAutomaticBlockMargins();
    initTagEditButtons();
    initInlineBlockAdder();
};

// Block unwanted interactions in DEV mode
const enforceDevInteractionModes = (e: MouseEvent | PointerEvent) => {
    const target = e.target as HTMLElement;
    if (isMountainTagPage(window.location.pathname)) return;

    // Allow our specific Dev UI buttons, tags, AND all interactions within dialogs
    if (target.closest('.dev-block-toolbar') || target.closest('.dev-tag-edit-btn') || target.closest('.tag-link') || target.closest('dialog')) {
        return;
    }

    const wrapper = target.closest('.photo-wrapper');

    // In dev mode, clicking a photo wrapper now behaves like production (opens PhotoSwipe/Next)
    // Tagging is reserved for right-click (contextmenu)
    if (wrapper) {
        if (e.type === 'mousedown' || e.type === 'pointerdown') {
            // Let PhotoSwipe/interactions proceed
            return;
        }
        return;
    }

    // If right-clicking anywhere in dev, hide it from PhotoSwipe's pointerdown/clicks
    if (e.button === 2) {
        e.stopPropagation();
    }
};

window.addEventListener('mousedown', enforceDevInteractionModes, true);
window.addEventListener('pointerdown', enforceDevInteractionModes, true);
window.addEventListener('click', enforceDevInteractionModes, true);

// Native right-click context menu prevention to handle Tag Dialog
window.addEventListener('contextmenu', (e) => {
    if (isMountainTagPage(window.location.pathname)) return;
    const target = e.target as HTMLElement;
    const wrapper = target.closest('.photo-wrapper');
    // Ensure clicks on toolbar elements get native menus or nothing
    if (
        target.closest('.dev-block-toolbar') ||
        target.closest('.dev-tag-edit-btn') ||
        target.closest('[data-album-photo-grid]')
    ) return;

    if (wrapper) {
        if (!wrapper.closest('.dev-tag-mode')) return;
        e.preventDefault();
        e.stopPropagation();
        if (pasteCopiedTagAtPointer(e as MouseEvent, wrapper as HTMLElement)) return;
        performTagging(e as MouseEvent, wrapper as HTMLElement);
    }
}, true);

window.addEventListener('keydown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const isEditingText = Boolean(
        target?.closest('dialog, input, textarea, select, [role="textbox"]')
        || (target instanceof HTMLElement && target.isContentEditable),
    );

    if (
        activeBlockEditMode
        && activeOrderMode
        && !pendingSaveInProgress
        && !isEditingText
        && !document.querySelector('dialog[open]')
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey
    ) {
        if (event.key === 'F1') {
            event.preventDefault();
            toggleInlineTagMode();
            return;
        }
        if (event.key === 'F2') {
            event.preventDefault();
            triggerInlinePhotoAction('merge');
            return;
        }
        if (event.key === 'F3') {
            event.preventDefault();
            triggerInlinePhotoAction('split');
            return;
        }
    }

    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (cancelInlineOrderMove()) {
        event.preventDefault();
        return;
    }
    if (activeTagMode && copiedTagName) {
        event.preventDefault();
        setCopiedTagName(null);
        showToast('ℹ️ Tag copy cancelled');
    }
});

const init = () => {
    if (isMountainTagPage(window.location.pathname)) {
        document.getElementById('dev-gear-btn')?.remove();
        document.getElementById('dev-save-btn')?.remove();
        document.getElementById('dev-tag-toggle')?.remove();
        document.getElementById('dev-album-sync-btn')?.remove();
        return;
    }
    syncAlbumTagStateFromDom();
    initToolbars();
    initInlineBlockAdder();
    initAlbumMetadataEditor();
    initFolderCoverEditors();
    const isAlbumPage = !isRootPage() && !isFolderPage() && !isMountainTagIndex(window.location.pathname);
    if (isAlbumPage) {
        document.getElementById('dev-gear-btn')?.remove();
    } else {
        document.getElementById('dev-save-btn')?.remove();
        document.getElementById('dev-tag-toggle')?.remove();
        document.getElementById('dev-album-sync-btn')?.remove();
    }
    const savedScrollY = sessionStorage.getItem('dev-caption-save-scroll-y');
    if (savedScrollY) {
        sessionStorage.removeItem('dev-caption-save-scroll-y');
        window.requestAnimationFrame(() => window.scrollTo({ top: Number(savedScrollY) }));
    }

    const primaryButtonId = isAlbumPage ? 'dev-save-btn' : 'dev-gear-btn';

    // Add the page-specific primary action.
    if (!document.getElementById(primaryButtonId)) {
        const gearBtn = document.createElement(isAlbumPage ? 'button' : 'div');
        gearBtn.id = primaryButtonId;
        gearBtn.className = isAlbumPage ? 'dev-save-btn' : 'dev-gear-btn';
        gearBtn.innerHTML = isAlbumPage ? ICONS.pencil : ICONS.gear;

        if (isRootPage()) {
            gearBtn.title = 'R2 Manager';
            gearBtn.addEventListener('click', openR2Manager);
        } else if (isMountainTagIndex(window.location.pathname)) {
            gearBtn.title = 'Region Manager';
            gearBtn.addEventListener('click', openRegionManager);
        } else if (isFolderPage()) {
            gearBtn.title = 'Folder Manager';
            gearBtn.addEventListener('click', openFolderManager);
        } else {
            gearBtn.title = 'Edit blocks';
            gearBtn.setAttribute('aria-label', gearBtn.title);
            gearBtn.setAttribute('aria-pressed', 'false');
            gearBtn.addEventListener('click', () => {
                if (pendingSaveInProgress) return;
                if (hasPendingChanges()) {
                    void savePendingChanges();
                    return;
                }
                if (activeBlockEditMode) {
                    setGlobalTagMode(false);
                    setLayoutEditMode(false);
                    return;
                }
                if (!canStartEditMode('blocks')) return;
                closeOtherPageEditors();
                setLayoutEditMode(true);
            });
        }

        // Try to find the scroll buttons container
        const scrollContainer = document.querySelector('.fixed.bottom-8.right-8.flex-col');
        if (scrollContainer) {
            gearBtn.classList.add('in-container');
            scrollContainer.appendChild(gearBtn);
        } else {
            document.body.appendChild(gearBtn);
        }
    }

    if (
        !isRootPage() &&
        !isFolderPage() &&
        !isMountainTagIndex(window.location.pathname) &&
        !document.getElementById('dev-save-btn')
    ) {
        const saveBtn = document.createElement('button');
        saveBtn.id = 'dev-save-btn';
        saveBtn.className = 'dev-save-btn';
        saveBtn.type = 'button';
        saveBtn.innerHTML = ICONS.pencil;
        saveBtn.title = 'Edit blocks';
        saveBtn.setAttribute('aria-label', 'Edit blocks');
        saveBtn.setAttribute('aria-pressed', 'false');
        saveBtn.addEventListener('click', () => {
            if (pendingSaveInProgress) return;
            if (hasPendingChanges()) {
                void savePendingChanges();
                return;
            }
            if (activeBlockEditMode) {
                setGlobalTagMode(false);
                setLayoutEditMode(false);
                return;
            }
            if (!canStartEditMode('blocks')) return;
            closeOtherPageEditors(saveBtn);
            setLayoutEditMode(true);
        });

        const scrollContainer = document.querySelector('.fixed.bottom-8.right-8.flex-col');
        if (scrollContainer) {
            saveBtn.classList.add('in-container');
            scrollContainer.appendChild(saveBtn);
        } else {
            document.body.appendChild(saveBtn);
        }
    }

    if (isAlbumPage && !document.getElementById('dev-album-sync-btn')) {
        const syncBtn = document.createElement('button');
        syncBtn.id = 'dev-album-sync-btn';
        syncBtn.className = 'dev-gear-btn dev-album-sync-btn';
        syncBtn.type = 'button';
        syncBtn.innerHTML = ICONS.refresh;
        syncBtn.title = 'Sync with R2';
        syncBtn.setAttribute('aria-label', 'Sync with R2');
        syncBtn.addEventListener('click', () => {
            const albumSlug = getAlbumSlug();
            if (!albumSlug) return showToast('❌ Cannot identify album');
            if (hasPendingBlockChanges()) {
                return showToast('⚠️ Save pending layout changes before syncing with R2');
            }
            void openAlbumSyncDialog(albumSlug);
        });

        const scrollContainer = document.querySelector('.fixed.bottom-8.right-8.flex-col');
        if (scrollContainer) {
            syncBtn.classList.add('in-container');
            scrollContainer.appendChild(syncBtn);
        } else {
            document.body.appendChild(syncBtn);
        }
    }

    // Keep the album controls directly below Scroll to bottom in their intended order.
    if (isAlbumPage) {
        const scrollContainer = document.querySelector('.fixed.bottom-8.right-8.flex-col');
        const controls = [
            document.getElementById('dev-save-btn'),
            document.getElementById('dev-album-sync-btn'),
        ];
        if (scrollContainer) controls.forEach((control) => {
            if (control) scrollContainer.appendChild(control);
        });
    }

    updateSaveButtonState();
};

installPageLifecycle(document, () => {
    init();
});
