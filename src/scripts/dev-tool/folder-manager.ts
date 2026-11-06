import { ICONS, showToast, sortableInstances, loadSortable } from "./ui";
import { getFolderSlug } from "./routes";
import { type PendingPhotoImport, openPhotoImportDialog } from "./photo-import";

function confirmPagePathDeletion(pagePath: string) {
    return new Promise<boolean>((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.style.cssText = 'border:0;border-radius:12px;padding:0;box-shadow:0 20px 50px rgba(0,0,0,.3);';
        dialog.innerHTML = `
            <div style="width:min(520px,90vw);background:white;border-radius:12px;overflow:hidden;font-family:sans-serif;">
                <header style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid #fee2e2;background:#fff7f7;">
                    <h3 style="margin:0;color:#991b1b;font-size:1rem;">Delete Page</h3>
                    <button data-delete-page-close class="dev-manager-header-button" type="button">${ICONS.close}</button>
                </header>
                <div style="padding:1.25rem;">
                    <p style="margin:0;color:#475569;font-size:.85rem;line-height:1.5;">Type the complete page path to continue:</p>
                    <code data-delete-page-path style="display:block;margin:.75rem 0;padding:.65rem;background:#f1f5f9;border-radius:5px;color:#0f172a;"></code>
                    <input data-delete-page-input type="text" autocomplete="off" spellcheck="false" style="width:100%;box-sizing:border-box;padding:.6rem;border:1px solid #cbd5e1;border-radius:5px;font:13px monospace;" />
                    <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;"><button data-delete-page-cancel type="button" style="padding:.5rem .8rem;border:1px solid #cbd5e1;border-radius:5px;background:white;cursor:pointer;">Cancel</button><button data-delete-page-confirm type="button" disabled style="padding:.5rem .8rem;border:0;border-radius:5px;background:#dc2626;color:white;cursor:pointer;">Stage deletion</button></div>
                </div>
            </div>`;
        document.body.appendChild(dialog);
        const input = dialog.querySelector('[data-delete-page-input]') as HTMLInputElement;
        const confirmButton = dialog.querySelector('[data-delete-page-confirm]') as HTMLButtonElement;
        (dialog.querySelector('[data-delete-page-path]') as HTMLElement).textContent = pagePath;
        const finish = (result: boolean) => {
            resolve(result);
            dialog.close();
        };
        input.addEventListener('input', () => { confirmButton.disabled = input.value.trim() !== pagePath; });
        confirmButton.addEventListener('click', () => { if (!confirmButton.disabled) finish(true); });
        dialog.querySelector('[data-delete-page-cancel]')?.addEventListener('click', () => finish(false));
        dialog.querySelector('[data-delete-page-close]')?.addEventListener('click', () => finish(false));
        dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        dialog.showModal();
        input.focus();
    });
}

// Folder Manager
function createFolderManagerDialog() {
    let existing = document.getElementById("dev-fm-dialog") as HTMLDialogElement;
    if (existing) return existing;

    const dialog = document.createElement("dialog");
    dialog.id = "dev-fm-dialog";
    dialog.innerHTML = `
        <div style="display: flex; flex-direction: column; height: 80vh; max-height: 800px; width: 600px; max-width: 90vw; background: white; border-radius: 12px; overflow: hidden; font-family: sans-serif;">
            <div style="padding: 1rem 1.5rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #fafafa;">
                <h3 style="margin: 0; font-size: 1rem; color: #333;">Folder Manager</h3>
                <div class="dev-manager-header-actions">
                    <button id="dev-fm-add-page" class="dev-manager-header-button" type="button" title="Add Page" aria-label="Add Page">${ICONS.plus}</button>
                    <button id="dev-fm-confirm" class="dev-manager-header-button dev-manager-header-button--save" type="button" title="No pending changes" aria-label="Save Changes" disabled>${ICONS.check}</button>
                    <button id="dev-fm-close" class="dev-manager-header-button" type="button" title="Close" aria-label="Close">${ICONS.close}</button>
                </div>
            </div>
            <div id="dev-fm-content" style="flex: 1; overflow-y: auto; padding: 1.5rem;">
                <div id="dev-fm-tree" class="dev-pm-tree"></div>
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

export async function openFolderManager() {
    const folder = getFolderSlug();
    if (!folder) return showToast("❌ Cannot identify folder");

    showToast("⌛ Loading folder structure...");
    const res = await fetch(`/api/get-folder-structure?folder=${folder}`);
    if (!res.ok) return showToast("❌ Failed to load structure");

    const data = await res.json();
    const Tree = (window as any).Sortable ? (window as any).Sortable : await loadSortable();

    const dialog = createFolderManagerDialog();
    const treeContainer = dialog.querySelector("#dev-fm-tree") as HTMLElement;
    const closeBtn = dialog.querySelector("#dev-fm-close") as HTMLButtonElement;
    const confirmBtn = dialog.querySelector("#dev-fm-confirm") as HTMLButtonElement;
    const addPageBtn = dialog.querySelector("#dev-fm-add-page") as HTMLButtonElement;

    let currentAlbums = data.albums.map((album: any) => ({ ...album }));
    let selectedAlbum: number | null = null;
    const pendingImports: PendingPhotoImport[] = [];
    const initialSnapshot = JSON.stringify(currentAlbums);
    const draftSnapshot = () => JSON.stringify({
        albums: currentAlbums,
        imports: pendingImports.map((item) => ({
            albumSlug: item.albumSlug,
            title: item.title,
            createPage: item.createPage,
            files: item.files.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
        })),
    });
    const baselineSnapshot = JSON.stringify({ albums: JSON.parse(initialSnapshot), imports: [] });
    const updateFolderDirtyState = () => {
        const dirty = draftSnapshot() !== baselineSnapshot;
        confirmBtn.disabled = !dirty;
        confirmBtn.title = dirty ? 'Save Changes' : 'No pending changes';
    };

    const stageImport = (pending: PendingPhotoImport) => {
        if (pending.createPage && currentAlbums.some((album: any) => album.slug === `${folder}/${pending.albumSlug}`)) {
            showToast('❌ Page path already exists');
            return;
        }
        const existingPending = pendingImports.findIndex((item) => item.albumSlug === pending.albumSlug);
        if (existingPending >= 0) {
            const existing = pendingImports[existingPending];
            if (pending.replaceExisting) {
                pendingImports.splice(existingPending, 1, {
                    ...pending,
                    createPage: existing.createPage,
                    replaceExisting: false,
                });
            } else {
                const combined = [...existing.files];
                for (const file of pending.files) {
                    const duplicate = combined.find((candidate) => candidate.name === file.name);
                    if (duplicate) {
                        showToast(`❌ Duplicate filename: ${file.name}`);
                        return;
                    }
                    combined.push(file);
                }
                pendingImports.splice(existingPending, 1, { ...existing, files: combined });
            }
        } else pendingImports.push(pending);
        if (pending.createPage) {
            currentAlbums.unshift({
                slug: `${folder}/${pending.albumSlug}`,
                title: pending.title,
                info: '',
                coverKey: pending.files[0]?.name || '',
                coverZoom: 1,
                coverOffset: { x: 50, y: 50 },
                pending: true,
            });
        } else {
            const targetAlbum = currentAlbums.find((album: any) => album.slug === `${folder}/${pending.albumSlug}`);
            if (targetAlbum?.pending && !targetAlbum.coverKey) targetAlbum.coverKey = pending.files[0]?.name || targetAlbum.coverKey;
            else if (targetAlbum) targetAlbum.hasPendingImport = true;
        }
        updateFolderDirtyState();
        renderView();
    };

    addPageBtn.addEventListener('click', () => {
        openPhotoImportDialog({ folder, createPage: true, onStage: stageImport });
    });

    const moveAlbum = (from: number, target: number) => {
        const [moved] = currentAlbums.splice(from, 1);
        currentAlbums.splice(target, 0, moved);
        selectedAlbum = null;
        updateFolderDirtyState();
    };

    const moveSelectedAlbumToGap = (gapIndex: number) => {
        if (selectedAlbum === null) return;
        const from = selectedAlbum;
        moveAlbum(from, from < gapIndex ? gapIndex - 1 : gapIndex);
        renderView();
    };

    const renderView = () => {
        sortableInstances.forEach(s => s.destroy());
        sortableInstances.length = 0;

        treeContainer.innerHTML = '';
        currentAlbums.forEach((album: any, idx: number) => {
            const el = document.createElement('div');
            el.className = 'dev-pm-block';
            el.style.padding = '0.75rem';
            el.style.marginBottom = '0.5rem';
            el.style.background = album.pendingDeletion ? '#fef2f2' : selectedAlbum === idx ? '#eff6ff' : '#f8fafc';
            el.style.outline = selectedAlbum === idx ? '2px solid #2563eb' : 'none';
            el.style.outlineOffset = '1px';
            el.style.borderRadius = '6px';
            el.dataset.slug = album.slug;
            el.innerHTML = `
                <div style="display:flex;align-items:center;gap:0.75rem;">
                    ${selectedAlbum === idx
                        ? `<button class="fm-drag-handle fm-selected" style="background:none;border:none;cursor:pointer;color:#2563eb;padding:4px;display:flex;align-items:center;" title="Cancel move">${ICONS.drag}</button>`
                        : `<button class="fm-drag-handle" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:4px;display:flex;align-items:center;" title="Click to move">${ICONS.drag}</button>`
                    }
                    <div class="fm-main" style="flex:1;min-width:0;">
                        <div style="font-weight:500;color:#334155;">${album.title || album.slug.split('/').pop()}</div>
                        <div style="font-size:0.7rem;color:${album.pendingDeletion ? '#dc2626' : '#94a3b8'};font-family:monospace;">${album.slug}${album.pendingDeletion ? ' · pending deletion' : album.pending ? ' · pending page' : album.hasPendingImport ? ' · pending photos' : ''}</div>
                    </div>
                    ${album.pendingDeletion
                        ? `<button class="fm-undo-delete dev-manager-header-button" type="button" title="Undo page deletion">${ICONS.refresh}</button>`
                        : `${album.pending ? `<button class="fm-import-photos dev-manager-header-button" type="button" title="Add more photos to pending page" aria-label="Add Photos">${ICONS.plus}</button>` : ''}<button class="fm-delete-page dev-manager-header-button" type="button" title="Delete Page" aria-label="Delete ${album.slug}" style="color:#dc2626;">${ICONS.trash}</button>`}
                </div>
                ${selectedAlbum !== null && idx === 0 ? `<div class="dev-pm-inline-add-zone dev-pm-inline-add-zone--before is-active"><button class="dev-pm-inline-add-button fm-move-gap" type="button" data-fm-gap-index="0" title="Move here">${ICONS.arrowRight}</button></div>` : ''}
                ${selectedAlbum !== null ? `<div class="dev-pm-inline-add-zone is-active"><button class="dev-pm-inline-add-button fm-move-gap" type="button" data-fm-gap-index="${idx + 1}" title="Move here">${ICONS.arrowRight}</button></div>` : ''}
            `;

            el.querySelector('.fm-import-photos')?.addEventListener('click', (event) => {
                event.stopPropagation();
                openPhotoImportDialog({
                    folder,
                    albumSlug: album.slug.split('/').pop(),
                    title: album.title || album.slug.split('/').pop(),
                    createPage: false,
                    stagedFiles: pendingImports.find((item) => item.albumSlug === album.slug.split('/').pop())?.files,
                    onStage: stageImport,
                });
            });
            el.querySelector('.fm-delete-page')?.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (!await confirmPagePathDeletion(album.slug)) return;
                if (album.pending) {
                    const pendingIndex = pendingImports.findIndex((item) => `${folder}/${item.albumSlug}` === album.slug);
                    if (pendingIndex >= 0) pendingImports.splice(pendingIndex, 1);
                    currentAlbums.splice(idx, 1);
                } else album.pendingDeletion = true;
                selectedAlbum = null;
                updateFolderDirtyState();
                renderView();
            });
            el.querySelector('.fm-undo-delete')?.addEventListener('click', (event) => {
                event.stopPropagation();
                album.pendingDeletion = false;
                updateFolderDirtyState();
                renderView();
            });

            el.querySelector('.fm-drag-handle')?.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedAlbum = selectedAlbum === idx ? null : idx;
                renderView();
            });

            el.querySelector('.fm-move-gap')?.addEventListener('click', (e) => {
                e.stopPropagation();
                moveSelectedAlbumToGap(Number((e.currentTarget as HTMLElement).dataset.fmGapIndex));
            });

            treeContainer.appendChild(el);
        });

        document.addEventListener('keydown', function escHandler(e: KeyboardEvent) {
            if (e.key === 'Escape' && selectedAlbum !== null) {
                selectedAlbum = null;
                renderView();
                document.removeEventListener('keydown', escHandler);
            }
        }, { once: false });

        sortableInstances.push(new Tree(treeContainer, {
            animation: 150,
            ghostClass: 'dev-pm-ghost',
            handle: '.fm-drag-handle',
            onEnd: (evt: any) => {
                moveAlbum(evt.oldIndex, evt.newIndex);
                window.setTimeout(renderView, 0);
            }
        }));

    };

    const closeHandler = () => {
        if (!confirmBtn.disabled && !confirm('Discard unsaved Folder Manager changes?')) return;
        dialog.close();
        closeBtn.removeEventListener('click', closeHandler);
        confirmBtn.removeEventListener('click', confirmHandler);
    };

    const confirmHandler = async () => {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '...';
        try {
            const pageDeletions = currentAlbums.filter((album: any) => album.pendingDeletion);
            for (const pending of pendingImports) {
                const form = new FormData();
                form.set('folder', folder);
                form.set('albumSlug', pending.albumSlug);
                form.set('title', pending.title);
                form.set('createPage', String(pending.createPage));
                pending.files.forEach((file) => form.append('photos', file, file.name));
                const importResponse = await fetch('/api/import-album-photos', { method: 'POST', body: form });
                const importResult = await importResponse.json().catch(() => ({}));
                if (!importResponse.ok) throw new Error(importResult.error || 'Photo import failed');
                pending.createPage = false;
            }
            for (const album of pageDeletions) {
                const deleteResponse = await fetch('/api/delete-album-page', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pagePath: album.slug }),
                });
                const deleteResult = await deleteResponse.json().catch(() => ({}));
                if (!deleteResponse.ok) throw new Error(deleteResult.error || `Failed to delete ${album.slug}`);
            }
            const activeAlbums = currentAlbums.filter((album: any) => !album.pendingDeletion);
            const res = await fetch("/api/save-folder-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    folder,
                    order: activeAlbums.map((album: any) => album.slug),
                }),
            });
            if (res.ok) {
                showToast("✅ Folder changes saved!");
                setTimeout(() => window.location.reload(), 1000);
            } else {
                showToast("❌ Save failed");
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = ICONS.check;
            }
        } catch (error: any) {
            showToast(`❌ ${error?.message || 'Save failed'}`);
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = ICONS.check;
        }
    };

    closeBtn.addEventListener('click', closeHandler);
    confirmBtn.addEventListener('click', confirmHandler);

    renderView();
    updateFolderDirtyState();
    dialog.showModal();
}
