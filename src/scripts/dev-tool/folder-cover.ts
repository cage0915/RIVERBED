import { isMountainTagIndex } from "../../lib/dev-route-state";
import { createCoverSaveQueue, isCoverDraftCurrent, settleCoverSave } from "../../lib/dev-cover-state";
import { ICONS, showToast, escapeHtml } from "./ui";
import { isFolderPage } from "./routes";

type FolderCoverState = {
    albumSlug: string;
    coverKey: string;
    zoom: number;
    x: number;
    y: number;
};

type PersistedFolderCover = { state: FolderCoverState; imageSrc: string };

const persistedFolderCovers = new WeakMap<HTMLElement, PersistedFolderCover>();

const enqueueFolderCoverSave = createCoverSaveQueue();

const readFolderCoverState = (card: HTMLElement): FolderCoverState => ({
    albumSlug: card.dataset.albumSlug || '',
    coverKey: card.dataset.coverKey || '',
    zoom: Number(card.dataset.coverZoom || 1),
    x: Number(card.dataset.coverOffsetX || 50),
    y: Number(card.dataset.coverOffsetY || 50),
});

const applyFolderCoverState = (card: HTMLElement, state: FolderCoverState) => {
    card.dataset.coverKey = state.coverKey;
    card.dataset.coverZoom = String(state.zoom);
    card.dataset.coverOffsetX = String(state.x);
    card.dataset.coverOffsetY = String(state.y);
    const image = card.querySelector<HTMLImageElement>('.album-cover img');
    if (!image) return;
    image.style.setProperty('--zoom', String(state.zoom));
    image.style.setProperty('--ox', `${state.x}%`);
    image.style.setProperty('--oy', `${state.y}%`);
};

const saveFolderCover = (card: HTMLElement) => {
    const draftState = readFolderCoverState(card);
    const draftImageSrc = card.querySelector<HTMLImageElement>('.album-cover img')?.src || '';
    return enqueueFolderCoverSave(card, async () => {
    const image = card.querySelector<HTMLImageElement>('.album-cover img');
    applyFolderCoverState(card, draftState);
    if (image) image.src = draftImageSrc;
    const persisted = persistedFolderCovers.get(card) || {
        state: { ...draftState },
        imageSrc: draftImageSrc,
    };
    const draftStillOwnsUi = () => isCoverDraftCurrent(
        readFolderCoverState(card),
        image?.src || '',
        draftState,
        draftImageSrc,
    );
    const restorePersisted = () => {
        const restored = settleCoverSave(persisted, null);
        if (draftStillOwnsUi()) {
            applyFolderCoverState(card, restored.state);
            if (image) image.src = restored.imageSrc;
        }
    };
    let response: Response;
    let result: any;
    try {
        response = await fetch('/api/save-album-cover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                albumSlug: draftState.albumSlug,
                coverKey: draftState.coverKey,
                coverZoom: draftState.zoom,
                coverOffset: { x: draftState.x, y: draftState.y },
            }),
        });
        result = await response.json().catch(() => ({}));
    } catch {
        restorePersisted();
        showToast('❌ Unable to reach cover save API');
        return false;
    }
    if (!response.ok) {
        restorePersisted();
        showToast(`❌ ${result.error || 'Unable to save cover'}`);
        return false;
    }
    const saved = settleCoverSave(persisted, result, draftImageSrc);
    if (draftStillOwnsUi()) applyFolderCoverState(card, saved.state);
    persistedFolderCovers.set(card, saved);
    showToast('✅ Cover saved');
    return true;
    });
};

const openFolderCoverPicker = async (card: HTMLElement) => {
    const state = readFolderCoverState(card);
    showToast('⌛ Loading R2 photos...');
    const currentSource = state.coverKey.split('/').slice(0, 2).join('/');
    const response = await fetch(`/api/get-r2-cover-assets?albumSlug=${encodeURIComponent(currentSource)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return showToast(`❌ ${result.error || 'Unable to load R2 photos'}`);

    const albums = (result.albums || []) as Array<{ slug: string; count: number }>;
    if (albums.length === 0) return showToast('⚠️ No photos found under r2');
    const initialSource = albums.some((album) => album.slug === currentSource)
        ? currentSource
        : albums.some((album) => album.slug === state.albumSlug)
            ? state.albumSlug
            : albums[0].slug;

    document.getElementById('dev-cover-picker')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'dev-cover-picker';
    const normalizedCurrentKey = state.coverKey;
    dialog.innerHTML = `
        <div style="display:flex;flex-direction:column;width:min(780px,90vw);height:min(680px,82vh);background:white;border-radius:12px;overflow:hidden;font-family:sans-serif;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid #e2e8f0;background:#fafafa;">
                <div style="min-width:0;">
                    <h3 style="margin:0;color:#1e293b;font-size:1rem;">Choose cover photo</h3>
                    <label style="display:flex;align-items:center;gap:.35rem;margin-top:.45rem;color:#94a3b8;font:11px monospace;">
                        r2/
                        <select data-cover-source style="max-width:min(420px,60vw);padding:.3rem .45rem;border:1px solid #cbd5e1;border-radius:5px;background:white;color:#475569;font:11px monospace;">
                            ${albums.map((album) => `<option value="${escapeHtml(album.slug)}"${album.slug === initialSource ? ' selected' : ''}>${escapeHtml(album.slug)} (${album.count})</option>`).join('')}
                        </select>
                    </label>
                </div>
                <button data-cover-picker-close class="dev-manager-header-button" type="button" title="Close">${ICONS.close}</button>
            </div>
            <div style="flex:1;overflow:auto;padding:1rem;">
                <div class="dev-cover-picker-grid" data-cover-photo-grid></div>
            </div>
        </div>`;
    dialog.style.cssText = 'border:0;border-radius:12px;padding:0;box-shadow:0 20px 50px rgba(0,0,0,.3);';
    document.body.appendChild(dialog);
    const close = () => dialog.close();
    dialog.querySelector('[data-cover-picker-close]')?.addEventListener('click', close);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    const sourceSelect = dialog.querySelector<HTMLSelectElement>('[data-cover-source]')!;
    const photoGrid = dialog.querySelector<HTMLElement>('[data-cover-photo-grid]')!;
    let loadSequence = 0;
    const loadSourcePhotos = async (sourceAlbum: string, initialPhotos?: Array<{ name: string; key: string }>) => {
        const sequence = ++loadSequence;
        photoGrid.innerHTML = '<div style="grid-column:1/-1;padding:3rem;text-align:center;color:#94a3b8;">Loading photos…</div>';
        let photos = initialPhotos;
        if (!photos) {
            const sourceResponse = await fetch(`/api/get-r2-cover-assets?albumSlug=${encodeURIComponent(sourceAlbum)}`);
            const sourceResult = await sourceResponse.json().catch(() => ({}));
            if (sequence !== loadSequence) return;
            if (!sourceResponse.ok) {
                photoGrid.innerHTML = `<div style="grid-column:1/-1;padding:3rem;text-align:center;color:#dc2626;">${escapeHtml(sourceResult.error || 'Unable to load photos')}</div>`;
                return;
            }
            photos = sourceResult.photos || [];
        }
        if (sequence !== loadSequence) return;
        if (!photos?.length) {
            photoGrid.innerHTML = '<div style="grid-column:1/-1;padding:3rem;text-align:center;color:#94a3b8;">No photos in this folder</div>';
            return;
        }
        photoGrid.innerHTML = photos.map((photo) => {
            const source = `/r2/${photo.key.split('/').map(encodeURIComponent).join('/')}`;
            return `<button class="dev-cover-picker-photo${photo.key === normalizedCurrentKey ? ' is-current' : ''}" type="button" data-cover-key="${escapeHtml(photo.key)}" title="${escapeHtml(photo.key)}"><img src="${source}" loading="lazy" alt="" /><span>${escapeHtml(photo.name)}</span></button>`;
        }).join('');
        photoGrid.querySelectorAll<HTMLElement>('[data-cover-key]').forEach((button) => {
            button.addEventListener('click', async () => {
                const fullKey = button.dataset.coverKey;
                if (!fullKey) return;
                const nextState = { ...readFolderCoverState(card), coverKey: fullKey, zoom: 1, x: 50, y: 50 };
                applyFolderCoverState(card, nextState);
                const image = card.querySelector<HTMLImageElement>('.album-cover img');
                if (image) image.src = `/r2/${fullKey.split('/').map(encodeURIComponent).join('/')}`;
                close();
                await saveFolderCover(card);
            });
        });
    };
    sourceSelect.addEventListener('change', () => void loadSourcePhotos(sourceSelect.value));
    void loadSourcePhotos(initialSource, initialSource === currentSource ? result.photos || [] : undefined);
    dialog.showModal();
};

export const initFolderCoverEditors = () => {
    if (!isFolderPage() || isMountainTagIndex(window.location.pathname)) return;
    document.querySelectorAll<HTMLElement>('.album-card[data-album-slug]').forEach((card) => {
        if (card.dataset.coverEditorInitialized === 'true') return;
        card.dataset.coverEditorInitialized = 'true';
        const cover = card.querySelector<HTMLElement>('.album-cover');
        const link = card.querySelector<HTMLAnchorElement>('.album-link');
        if (!cover || !link) return;
        const coverImage = cover.querySelector<HTMLImageElement>('img');
        persistedFolderCovers.set(card, {
            state: readFolderCoverState(card),
            imageSrc: coverImage?.src || '',
        });

        const actions = document.createElement('div');
        actions.className = 'dev-folder-cover-actions';
        actions.innerHTML = `
            <button class="dev-folder-cover-button" data-cover-photo type="button" title="Choose cover photo" aria-label="Choose cover photo">${ICONS.image}</button>
            <button class="dev-folder-cover-button" data-cover-adjust type="button" title="Adjust cover crop" aria-label="Adjust cover crop">${ICONS.gear}</button>`;
        card.appendChild(actions);
        const photoButton = actions.querySelector<HTMLButtonElement>('[data-cover-photo]')!;
        const adjustButton = actions.querySelector<HTMLButtonElement>('[data-cover-adjust]')!;
        let drag: { pointerId: number; startX: number; startY: number; x: number; y: number } | null = null;
        let editSnapshot = '';

        const cropSnapshot = () => {
            const state = readFolderCoverState(card);
            return `${state.zoom}:${state.x}:${state.y}`;
        };
        const setEditing = (editing: boolean, persist = true) => {
            card.classList.toggle('dev-cover-editing', editing);
            adjustButton.classList.toggle('is-active', editing);
            adjustButton.title = editing ? 'Finish adjusting cover' : 'Adjust cover crop';
            cover.querySelector('.dev-cover-edit-hint')?.remove();
            if (editing) {
                editSnapshot = cropSnapshot();
                document.querySelectorAll<HTMLElement>('.album-card.dev-cover-editing').forEach((other) => {
                    if (other !== card) other.querySelector<HTMLButtonElement>('[data-cover-adjust]')?.click();
                });
                cover.insertAdjacentHTML('beforeend', '<div class="dev-cover-edit-hint">Scroll to zoom · drag to reposition</div>');
            } else if (persist && cropSnapshot() !== editSnapshot) {
                void saveFolderCover(card);
            }
        };

        photoButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (card.classList.contains('dev-cover-editing')) setEditing(false, false);
            void openFolderCoverPicker(card);
        });
        adjustButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setEditing(!card.classList.contains('dev-cover-editing'));
        });
        link.addEventListener('click', (event) => {
            if (card.classList.contains('dev-cover-editing')) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);
        cover.addEventListener('wheel', (event) => {
            if (!card.classList.contains('dev-cover-editing')) return;
            event.preventDefault();
            const state = readFolderCoverState(card);
            state.zoom = Math.min(4, Math.max(1, Math.round((state.zoom - event.deltaY * 0.0015) * 100) / 100));
            applyFolderCoverState(card, state);
        }, { passive: false });
        cover.addEventListener('pointerdown', (event) => {
            if (!card.classList.contains('dev-cover-editing') || (event.target as Element).closest('button')) return;
            event.preventDefault();
            const state = readFolderCoverState(card);
            drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: state.x, y: state.y };
            card.classList.add('is-dragging');
            cover.setPointerCapture(event.pointerId);
        });
        cover.addEventListener('pointermove', (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const bounds = cover.getBoundingClientRect();
            const state = readFolderCoverState(card);
            state.x = Math.min(100, Math.max(0, Math.round((drag.x - (event.clientX - drag.startX) / bounds.width * 100) * 10) / 10));
            state.y = Math.min(100, Math.max(0, Math.round((drag.y - (event.clientY - drag.startY) / bounds.height * 100) * 10) / 10));
            applyFolderCoverState(card, state);
        });
        const finishDrag = (event: PointerEvent) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            drag = null;
            card.classList.remove('is-dragging');
        };
        cover.addEventListener('pointerup', finishDrag);
        cover.addEventListener('pointercancel', finishDrag);
    });
};
