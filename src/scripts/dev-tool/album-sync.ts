import { ICONS, showToast } from "./ui";

export async function openAlbumSyncDialog(albumSlug: string) {
    showToast('⌛ Building R2 dry run...');
    const response = await fetch(`/api/r2-album-plan?albumSlug=${encodeURIComponent(albumSlug)}`, { cache: 'no-store' });
    const plan = await response.json().catch(() => ({}));
    if (!response.ok) return showToast(`❌ ${plan.error || 'R2 audit failed'}`);

    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'border:0;border-radius:12px;padding:0;box-shadow:0 20px 50px rgba(0,0,0,.3);';
    const localKeys = new Set([
        ...(plan.required || []).filter((item: any) => item.local).map((item: any) => item.key),
        ...(plan.localCandidates || []).map((item: any) => item.key),
    ]);
    const remoteDownloadKeys = [...new Set([
        ...(plan.required || []).filter((item: any) => item.remote).map((item: any) => item.key),
        ...(plan.remoteExtras || []).map((item: any) => item.key),
    ])].filter((key: any) => !localKeys.has(key));
    const actionable = plan.remoteAvailable
        ? [
            ...(plan.required || []).filter((item: any) => ['upload', 'overwrite', 'unknown'].includes(item.action)).map((item: any) => ({
                key: item.key,
                action: item.action === 'unknown' ? 'overwrite' : item.action,
                etag: item.remote?.etag,
                label: item.action === 'unknown' ? 'Overwrite (legacy hash unknown)' : item.action,
                group: item.action,
                checked: item.action !== 'unknown',
            })),
            ...remoteDownloadKeys.map((key: any) => ({ key, action: 'download', label: 'Download', group: 'download', checked: false })),
            ...(plan.remoteExtras || []).filter((item: any) => item.action === 'trash').map((item: any) => ({
                key: item.key,
                action: 'trash',
                etag: item.etag,
                label: 'Move to Trash',
                group: 'trash',
                checked: true,
            })),
        ] : [];
    const missing = (plan.required || []).filter((item: any) => item.action === 'missing');
    const protectedItems = (plan.remoteExtras || []).filter((item: any) => item.action === 'protected');
    const syncGroupDefinitions = [
        { id: 'download', label: 'Download' },
        { id: 'upload', label: 'Upload' },
        { id: 'overwrite', label: 'Overwrite' },
        { id: 'unknown', label: 'Overwrite (Legacy Hash Unknown)' },
        { id: 'trash', label: 'Move to Trash' },
    ];
    const rows = syncGroupDefinitions.map((group) => {
        const entries = actionable
            .map((item: any, index: number) => ({ item, index }))
            .filter(({ item }: any) => item.group === group.id);
        if (!entries.length) return '';
        return `
            <section data-sync-group-section="${group.id}" style="margin-bottom:.65rem;border:1px solid #e2e8f0;border-radius:7px;overflow:hidden;background:#fff;">
                <div style="display:flex;align-items:center;gap:.6rem;padding:.7rem .8rem;background:#f8fafc;color:#334155;font-weight:600;">
                    <button data-sync-group-expand="${group.id}" type="button" aria-label="Expand ${group.label}" aria-expanded="false" style="display:flex;align-items:center;justify-content:center;padding:4px;border:0;background:none;color:#64748b;cursor:pointer;transition:transform .2s;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                    <input data-sync-group="${group.id}" type="checkbox" aria-label="Select all ${group.label}" style="margin:0;" />
                    <button data-sync-group-label="${group.id}" type="button" style="display:flex;flex:1;align-items:center;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;">
                        <span style="flex:1;">${group.label}</span>
                        <span style="color:#94a3b8;font-size:.72rem;font-weight:400;">${entries.length}</span>
                    </button>
                </div>
                <div data-sync-group-list="${group.id}" hidden>
                    ${entries.map(({ item, index }: any) => `
                        <label style="display:flex;align-items:center;gap:.6rem;padding:.55rem .8rem;border-top:1px solid #edf2f7;cursor:pointer;">
                            <input data-sync-index="${index}" data-sync-entry-group="${group.id}" type="checkbox" ${item.checked ? 'checked' : ''} style="margin:0;" />
                            <code data-sync-name="${index}" style="min-width:0;overflow:hidden;color:#64748b;font-size:.72rem;text-overflow:ellipsis;white-space:nowrap;"></code>
                        </label>`).join('')}
                </div>
            </section>`;
    }).join('');
    dialog.innerHTML = `
        <div style="display:flex;flex-direction:column;width:min(720px,92vw);max-height:82vh;background:white;border-radius:12px;overflow:hidden;font-family:sans-serif;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid #e2e8f0;background:#fafafa;">
                <div><h3 style="margin:0;font-size:1rem;color:#334155;">R2 Sync Dry Run</h3><div style="font-size:.72rem;color:#64748b;margin-top:.2rem;">${albumSlug}</div></div>
                <div class="dev-manager-header-actions">
                    <button data-sync-action="save" class="dev-manager-header-button dev-manager-header-button--save" type="button" disabled title="No selected actions">${ICONS.check}</button>
                    <button data-sync-action="close" class="dev-manager-header-button" type="button">${ICONS.close}</button>
                </div>
            </div>
            <div style="overflow:auto;padding:1rem 1.25rem;">
                ${plan.remoteAvailable ? '' : `<p style="padding:.75rem;background:#fff7ed;color:#9a3412;border-radius:6px;">${plan.message || 'Remote R2 unavailable'}</p>`}
                ${missing.length ? `<p style="padding:.75rem;background:#fef2f2;color:#b91c1c;border-radius:6px;">${missing.length} source assets are missing from both local and R2.</p>` : ''}
                ${protectedItems.length ? `<p style="padding:.75rem;background:#eff6ff;color:#1d4ed8;border-radius:6px;">${protectedItems.length} remote extras remain protected by other source references.</p>` : ''}
                <div data-sync-rows>${rows || '<p style="color:#64748b;">No R2 changes proposed.</p>'}</div>
            </div>
        </div>`;
    dialog.querySelectorAll<HTMLElement>('[data-sync-name]').forEach((name) => {
        const item = actionable[Number(name.dataset.syncName)];
        name.textContent = item.key.split('/').pop() || item.key;
        name.title = item.key;
    });
    document.body.appendChild(dialog);
    const saveBtn = dialog.querySelector('[data-sync-action="save"]') as HTMLButtonElement;
    const update = () => {
        const selected = Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-sync-index]:checked'));
        saveBtn.disabled = selected.length === 0;
        saveBtn.title = selected.length ? `Execute ${selected.length} selected actions` : 'No selected actions';
        dialog.querySelectorAll<HTMLInputElement>('[data-sync-group]').forEach((groupInput) => {
            const entries = Array.from(dialog.querySelectorAll<HTMLInputElement>(`[data-sync-entry-group="${groupInput.dataset.syncGroup}"]`));
            const selectedCount = entries.filter((entry) => entry.checked).length;
            groupInput.checked = entries.length > 0 && selectedCount === entries.length;
            groupInput.indeterminate = selectedCount > 0 && selectedCount < entries.length;
        });
    };
    dialog.querySelectorAll('[data-sync-index]').forEach((input) => input.addEventListener('change', update));
    dialog.querySelectorAll<HTMLInputElement>('[data-sync-group]').forEach((groupInput) => {
        groupInput.addEventListener('change', () => {
            dialog.querySelectorAll<HTMLInputElement>(`[data-sync-entry-group="${groupInput.dataset.syncGroup}"]`).forEach((entry) => {
                entry.checked = groupInput.checked;
            });
            update();
        });
    });
    const toggleSyncGroup = (groupId: string) => {
        const list = dialog.querySelector(`[data-sync-group-list="${groupId}"]`) as HTMLElement | null;
        const button = dialog.querySelector(`[data-sync-group-expand="${groupId}"]`) as HTMLButtonElement | null;
        if (!list || !button) return;
        const expanded = list.hidden;
        list.hidden = !expanded;
        button.style.transform = expanded ? 'rotate(90deg)' : 'rotate(0deg)';
        button.setAttribute('aria-expanded', String(expanded));
        button.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${syncGroupDefinitions.find((group) => group.id === groupId)?.label || groupId}`);
    };
    dialog.querySelectorAll<HTMLElement>('[data-sync-group-expand], [data-sync-group-label]').forEach((control) => {
        control.addEventListener('click', () => toggleSyncGroup(control.dataset.syncGroupExpand || control.dataset.syncGroupLabel || ''));
    });
    dialog.querySelector('[data-sync-action="close"]')?.addEventListener('click', () => dialog.close());
    saveBtn.addEventListener('click', async () => {
        const actions = Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-sync-index]:checked')).map((input) => actionable[Number(input.dataset.syncIndex)]);
        if (!confirm(`Execute ${actions.length} R2 changes?`)) return;
        saveBtn.disabled = true;
        saveBtn.textContent = '…';
        const resultResponse = await fetch('/api/r2-sync-album', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ albumSlug, actions: actions.map(({ action, key, etag }: any) => ({ action, key, etag })) }),
        });
        const result = await resultResponse.json().catch(() => ({}));
        if (!resultResponse.ok) {
            saveBtn.innerHTML = ICONS.check;
            update();
            return showToast(`❌ ${result.error || 'R2 sync failed'}`);
        }
        showToast(`✅ ${result.results.length} R2 changes complete`);
        dialog.close();
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    update();
    dialog.showModal();
}
