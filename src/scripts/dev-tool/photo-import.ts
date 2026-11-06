import { sortPhotoImportFiles, type PhotoImportSortDirection, type PhotoImportSortKey } from "../../lib/photo-import-sort";
import { selectPhotoImportIndex } from "../../lib/photo-import-selection";
import { ICONS } from "./ui";

export type PendingPhotoImport = {
    albumSlug: string;
    title: string;
    createPage: boolean;
    files: File[];
    replaceExisting?: boolean;
};

export function openPhotoImportDialog(options: {
    folder: string;
    albumSlug?: string;
    title?: string;
    createPage: boolean;
    stagedFiles?: File[];
    onStage: (pending: PendingPhotoImport) => void;
}) {
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'border:0;border-radius:12px;padding:0;box-shadow:0 20px 50px rgba(0,0,0,.3);';
    dialog.innerHTML = `
        <div style="position:relative;display:flex;flex-direction:column;width:min(900px,92vw);height:min(760px,86vh);background:white;border-radius:12px;overflow:hidden;font-family:sans-serif;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid #e2e8f0;background:#fafafa;">
                <h3 style="margin:0;font-size:1rem;color:#334155;">${options.createPage ? 'Add Page & Add Photos' : 'Add Photos'}</h3>
                <div class="dev-manager-header-actions">
                    <button data-import-action="stage" class="dev-manager-header-button dev-manager-header-button--save" type="button" disabled title="Stage selected photos">${ICONS.check}</button>
                    <button data-import-action="close" class="dev-manager-header-button" type="button" title="Close">${ICONS.close}</button>
                </div>
            </div>
            <div style="flex:1;overflow:auto;padding:1.25rem;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;">
                    <label style="display:flex;flex-direction:column;gap:.3rem;font-size:.75rem;color:#64748b;">Page slug
                        <input data-import-field="slug" value="${options.albumSlug || ''}" ${options.createPage ? '' : 'readonly'} placeholder="2026-new-page" style="padding:.55rem;border:1px solid #cbd5e1;border-radius:5px;" />
                    </label>
                    <label style="display:flex;flex-direction:column;gap:.3rem;font-size:.75rem;color:#64748b;">Title
                        <input data-import-field="title" value="${options.title || ''}" ${options.createPage ? '' : 'readonly'} placeholder="New Page" style="padding:.55rem;border:1px solid #cbd5e1;border-radius:5px;" />
                    </label>
                </div>
                <label style="display:block;margin-top:.9rem;padding:.7rem;border:1px dashed #94a3b8;border-radius:7px;text-align:center;color:#475569;cursor:pointer;">
                    Browse / add another photo folder
                    <input data-import-field="files" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple webkitdirectory style="display:none;" />
                </label>
                <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem;margin-top:.65rem;color:#64748b;font-size:.75rem;">
                    <span>Click: select · Ctrl/⌘: toggle · Shift: range · Z: toggle</span>
                    <div style="display:flex;align-items:center;gap:.4rem;">
                        <button data-import-sort-name class="dev-import-sort-button" type="button"></button>
                        <button data-import-sort-time class="dev-import-sort-button" type="button"></button>
                    </div>
                    <span data-import-count>0 selected · 0 photos</span>
                </div>
                <div class="dev-import-grid" data-import-grid role="listbox" aria-label="Photos" aria-multiselectable="true"></div>
                <section data-import-staged-section style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid #e2e8f0;" hidden>
                    <div style="display:flex;align-items:center;justify-content:space-between;color:#475569;font-size:.78rem;font-weight:600;">
                        <span>Staged photos</span><span data-import-staged-count></span>
                    </div>
                    <div class="dev-import-staged-grid" data-import-staged-grid></div>
                </section>
            </div>
            <div class="dev-import-preview" data-import-preview hidden tabindex="-1">
                <button data-import-preview-close type="button" style="position:absolute;top:1rem;right:1rem;display:flex;width:2rem;height:2rem;align-items:center;justify-content:center;border:0;border-radius:50%;background:rgba(255,255,255,.15);color:white;cursor:pointer;">${ICONS.close}</button>
                <img data-import-preview-image alt="" />
                <div style="display:flex;align-items:center;gap:.65rem;margin-top:.7rem;color:white;font-size:.78rem;"><input data-import-preview-checkbox type="checkbox" style="width:1.1rem;height:1.1rem;accent-color:#16a34a;" /><span data-import-preview-name></span></div>
            </div>
        </div>`;
    document.body.appendChild(dialog);

    const slugInput = dialog.querySelector('[data-import-field="slug"]') as HTMLInputElement;
    const titleInput = dialog.querySelector('[data-import-field="title"]') as HTMLInputElement;
    const fileInput = dialog.querySelector('[data-import-field="files"]') as HTMLInputElement;
    const grid = dialog.querySelector('[data-import-grid]') as HTMLElement;
    const stagedSection = dialog.querySelector('[data-import-staged-section]') as HTMLElement;
    const stagedGrid = dialog.querySelector('[data-import-staged-grid]') as HTMLElement;
    const stagedCount = dialog.querySelector('[data-import-staged-count]') as HTMLElement;
    const count = dialog.querySelector('[data-import-count]') as HTMLElement;
    const sortNameBtn = dialog.querySelector('[data-import-sort-name]') as HTMLButtonElement;
    const sortTimeBtn = dialog.querySelector('[data-import-sort-time]') as HTMLButtonElement;
    const stageBtn = dialog.querySelector('[data-import-action="stage"]') as HTMLButtonElement;
    const preview = dialog.querySelector('[data-import-preview]') as HTMLElement;
    const previewImage = dialog.querySelector('[data-import-preview-image]') as HTMLImageElement;
    const previewName = dialog.querySelector('[data-import-preview-name]') as HTMLElement;
    const previewCheckbox = dialog.querySelector('[data-import-preview-checkbox]') as HTMLInputElement;
    let files: File[] = [];
    const stagedFiles: File[] = [...(options.stagedFiles || [])];
    let currentIndex = 0;
    let selectionAnchorIndex: number | null = null;
    const selected = new Set<number>();
    const objectUrls: string[] = [];
    const stagedObjectUrls: string[] = [];
    let sortKey: PhotoImportSortKey = 'name';
    let sortDirection: PhotoImportSortDirection = 'asc';

    const selectedFiles = () => [
        ...stagedFiles,
        ...[...selected].sort((a, b) => a - b).map((index) => files[index]),
    ];
    const duplicateNames = () => {
        const counts = new Map<string, number>();
        selectedFiles().forEach((file) => counts.set(file.name, (counts.get(file.name) || 0) + 1));
        return [...counts.entries()].filter(([, total]) => total > 1).map(([name]) => name);
    };
    const canStage = () => selectedFiles().length > 0 && duplicateNames().length === 0 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slugInput.value.trim()) && titleInput.value.trim().length > 0;
    const updatePreview = () => {
        if (preview.hidden || !files[currentIndex] || !objectUrls[currentIndex]) return;
        previewImage.src = objectUrls[currentIndex];
        previewName.textContent = files[currentIndex].webkitRelativePath || files[currentIndex].name;
        previewCheckbox.checked = selected.has(currentIndex);
    };
    const updateState = () => {
        const duplicates = duplicateNames();
        const chosenFiles = selectedFiles();
        const sourceFolders = new Set(chosenFiles.map((file) => file.webkitRelativePath?.split('/')[0]).filter(Boolean));
        const sourceLabel = sourceFolders.size ? ` · ${sourceFolders.size} folder${sourceFolders.size > 1 ? 's' : ''}` : '';
        count.textContent = duplicates.length
            ? `${duplicates.length} duplicate filename${duplicates.length > 1 ? 's' : ''}`
            : `${chosenFiles.length} selected · ${files.length} in current folder${stagedFiles.length ? ` · ${stagedFiles.length} staged` : ''}${sourceLabel}`;
        count.style.color = duplicates.length ? '#dc2626' : '#64748b';
        stageBtn.disabled = !canStage();
        grid.querySelectorAll('.dev-import-photo').forEach((element, index) => {
            element.classList.toggle('is-current', index === currentIndex);
            element.classList.toggle('is-selected', selected.has(index));
            element.setAttribute('aria-selected', String(selected.has(index)));
            const checkbox = element.querySelector<HTMLInputElement>('.dev-import-photo-checkbox');
            if (checkbox) checkbox.checked = selected.has(index);
        });
        updatePreview();
    };
    const renderStaged = () => {
        stagedObjectUrls.splice(0).forEach(URL.revokeObjectURL);
        stagedGrid.innerHTML = '';
        stagedSection.hidden = stagedFiles.length === 0;
        stagedCount.textContent = `${stagedFiles.length}`;
        stagedFiles.forEach((file, index) => {
            const url = URL.createObjectURL(file);
            stagedObjectUrls.push(url);
            const card = document.createElement('div');
            card.className = 'dev-import-staged-photo';
            card.innerHTML = `<img alt="" loading="lazy" /><button class="dev-import-staged-remove" type="button" title="Remove staged photo" aria-label="Remove staged photo">${ICONS.close}</button>`;
            (card.querySelector('img') as HTMLImageElement).src = url;
            card.title = file.webkitRelativePath || file.name;
            card.querySelector('.dev-import-staged-remove')?.addEventListener('click', () => {
                stagedFiles.splice(index, 1);
                renderStaged();
                updateState();
            });
            stagedGrid.appendChild(card);
        });
    };
    const applyPointerSelection = (
        event: MouseEvent,
        index: number,
        fromCheckbox = false,
    ) => {
        currentIndex = index;
        const nextSelection = selectPhotoImportIndex({
            selected,
            index,
            anchorIndex: selectionAnchorIndex,
            itemCount: files.length,
            additive: event.ctrlKey || event.metaKey || (fromCheckbox && !event.shiftKey),
            range: event.shiftKey,
        });
        selected.clear();
        nextSelection.selected.forEach((selectedIndex) => selected.add(selectedIndex));
        selectionAnchorIndex = nextSelection.anchorIndex;
        updateState();
    };
    const renderFiles = () => {
        objectUrls.splice(0).forEach(URL.revokeObjectURL);
        grid.innerHTML = '';
        files.forEach((file, index) => {
            const url = URL.createObjectURL(file);
            objectUrls.push(url);
            const card = document.createElement('div');
            card.className = 'dev-import-photo';
            card.setAttribute('role', 'option');
            card.tabIndex = 0;
            card.innerHTML = `<img src="${url}" alt="" loading="lazy" /><input class="dev-import-photo-checkbox" type="checkbox" aria-label="Select photo" /><span></span>`;
            (card.querySelector('span') as HTMLElement).textContent = file.name;
            const checkbox = card.querySelector('.dev-import-photo-checkbox') as HTMLInputElement;
            card.addEventListener('click', (event) => {
                if (event.target === checkbox) return;
                event.preventDefault();
                applyPointerSelection(event, index);
                card.focus({ preventScroll: true });
            });
            card.addEventListener('dblclick', (event) => {
                if (event.target === checkbox) return;
                currentIndex = index;
                preview.hidden = false;
                updateState();
                preview.focus({ preventScroll: true });
            });
            checkbox.addEventListener('click', (event) => {
                event.stopPropagation();
                applyPointerSelection(event, index, true);
                card.focus({ preventScroll: true });
            });
            grid.appendChild(card);
        });
        updateState();
    };
    const updateSortButtons = () => {
        const arrow = sortDirection === 'asc' ? '↑' : '↓';
        sortNameBtn.textContent = `Filename${sortKey === 'name' ? ` ${arrow}` : ''}`;
        sortTimeBtn.textContent = `Time${sortKey === 'time' ? ` ${arrow}` : ''}`;
        for (const [button, key, label] of [
            [sortNameBtn, 'name', 'filename'],
            [sortTimeBtn, 'time', 'modified time'],
        ] as const) {
            const active = sortKey === key;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
            button.title = active
                ? `Switch ${label} to ${sortDirection === 'asc' ? 'descending' : 'ascending'} order`
                : `Sort by ${label} in ascending order`;
        }
    };
    const applyFileSort = () => {
        const selectedFilesBeforeSort = new Set(
            [...selected].map((index) => files[index]).filter(Boolean),
        );
        const currentFile = files[currentIndex];
        const selectionAnchorFile = selectionAnchorIndex === null
            ? undefined
            : files[selectionAnchorIndex];
        files = sortPhotoImportFiles(files, sortKey, sortDirection);
        selected.clear();
        files.forEach((file, index) => {
            if (selectedFilesBeforeSort.has(file)) selected.add(index);
        });
        currentIndex = currentFile ? Math.max(0, files.indexOf(currentFile)) : 0;
        selectionAnchorIndex = selectionAnchorFile
            ? Math.max(0, files.indexOf(selectionAnchorFile))
            : null;
        updateSortButtons();
        renderFiles();
    };
    const selectSortKey = (nextKey: PhotoImportSortKey) => {
        if (sortKey === nextKey) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        else {
            sortKey = nextKey;
            sortDirection = 'asc';
        }
        applyFileSort();
    };
    sortNameBtn.addEventListener('click', () => selectSortKey('name'));
    sortTimeBtn.addEventListener('click', () => selectSortKey('time'));
    fileInput.addEventListener('change', () => {
        const added = Array.from(fileInput.files || []).filter((file) => /\.(jpe?g|png|webp|avif)$/i.test(file.name));
        if (added.length === 0) return;
        stagedFiles.push(...[...selected].sort((a, b) => a - b).map((index) => files[index]));
        files = sortPhotoImportFiles(added, sortKey, sortDirection);
        selected.clear();
        currentIndex = 0;
        selectionAnchorIndex = null;
        fileInput.value = '';
        renderStaged();
        renderFiles();
    });
    slugInput.addEventListener('input', updateState);
    titleInput.addEventListener('input', updateState);

    const getGridColumnCount = () => {
        const cards = Array.from(grid.children) as HTMLElement[];
        if (cards.length < 2) return 1;
        const firstRowTop = cards[0].offsetTop;
        const firstNextRow = cards.findIndex((card) => card.offsetTop > firstRowTop);
        return firstNextRow === -1 ? cards.length : Math.max(1, firstNextRow);
    };
    const keyHandler = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && !preview.hidden) {
            event.preventDefault();
            preview.hidden = true;
            (grid.children[currentIndex] as HTMLElement | undefined)?.focus({ preventScroll: true });
            return;
        }
        if (!files.length || (event.target instanceof HTMLInputElement && !event.target.classList.contains('dev-import-photo-checkbox') && event.target !== previewCheckbox)) return;
        const columns = getGridColumnCount();
        if (event.key === 'ArrowRight') currentIndex = Math.min(files.length - 1, currentIndex + 1);
        else if (event.key === 'ArrowLeft') currentIndex = Math.max(0, currentIndex - 1);
        else if (event.key === 'ArrowDown') currentIndex = Math.min(files.length - 1, currentIndex + columns);
        else if (event.key === 'ArrowUp') currentIndex = Math.max(0, currentIndex - columns);
        else if (event.key.toLowerCase() === 'z') {
            if (selected.has(currentIndex)) selected.delete(currentIndex);
            else selected.add(currentIndex);
            selectionAnchorIndex = currentIndex;
        }
        else return;
        event.preventDefault();
        updateState();
        const currentCard = grid.children[currentIndex] as HTMLElement | undefined;
        if (preview.hidden) currentCard?.focus({ preventScroll: true });
        else preview.focus({ preventScroll: true });
        currentCard?.scrollIntoView({ block: 'nearest' });
    };
    dialog.addEventListener('keydown', keyHandler);
    previewCheckbox.addEventListener('change', () => {
        selectionAnchorIndex = currentIndex;
        if (previewCheckbox.checked) selected.add(currentIndex);
        else selected.delete(currentIndex);
        updateState();
    });
    dialog.querySelector('[data-import-preview-close]')?.addEventListener('click', () => {
        preview.hidden = true;
        (grid.children[currentIndex] as HTMLElement | undefined)?.focus({ preventScroll: true });
    });
    const cleanup = () => {
        objectUrls.forEach(URL.revokeObjectURL);
        stagedObjectUrls.forEach(URL.revokeObjectURL);
        dialog.remove();
    };
    dialog.querySelector('[data-import-action="close"]')?.addEventListener('click', () => dialog.close());
    stageBtn.addEventListener('click', () => {
        if (!canStage()) return;
        options.onStage({
            albumSlug: slugInput.value.trim(),
            title: titleInput.value.trim(),
            createPage: options.createPage,
            files: selectedFiles(),
            replaceExisting: Boolean(options.stagedFiles),
        });
        dialog.close();
    });
    dialog.addEventListener('close', cleanup, { once: true });
    renderStaged();
    updateSortButtons();
    updateState();
    dialog.showModal();
}
