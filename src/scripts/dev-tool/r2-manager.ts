import { ICONS, showToast } from "./ui";

export async function openR2Manager() {
    showToast('⌛ Auditing source and R2...');
    const response = await fetch('/api/r2-global-plan', { cache: 'no-store' });
    const plan = await response.json().catch(() => ({}));
    if (!response.ok) return showToast(`❌ ${plan.error || 'R2 audit failed'}`);
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'border:0;border-radius:12px;padding:0;box-shadow:0 20px 50px rgba(0,0,0,.3);';
    const formatBytes = (bytes: number) => bytes < 1024 * 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
        : `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    const readonlyList = (title: string, items: any[], color: string, group: string) => `
        <details style="margin-top:.75rem;border:1px solid #e2e8f0;border-radius:7px;overflow:hidden;" ${items.length ? '' : 'open'}>
            <summary style="padding:.7rem;cursor:pointer;color:${color};font-weight:600;">${title} (${items.length})</summary>
            <div style="max-height:240px;overflow:auto;border-top:1px solid #e2e8f0;">${items.length ? items.map((_: any, index: number) => `<div data-r2-group="${group}" data-r2-index="${index}" style="padding:.5rem .7rem;border-bottom:1px solid #f1f5f9;font:12px monospace;word-break:break-all;"></div>`).join('') : '<div style="padding:.7rem;color:#64748b;">None</div>'}</div>
        </details>`;
    const orphanRows = (plan.orphans || []).map((_: any, index: number) => `
        <label style="display:flex;align-items:flex-start;gap:.6rem;padding:.6rem .7rem;border-bottom:1px solid #f1f5f9;cursor:pointer;">
            <input data-r2-orphan-index="${index}" type="checkbox" style="margin-top:.15rem;accent-color:#16a34a;" />
            <code style="min-width:0;font-size:.72rem;word-break:break-all;color:#475569;"></code>
        </label>`).join('');
    const orphanList = `
        <details style="margin-top:.75rem;border:1px solid #e2e8f0;border-radius:7px;overflow:hidden;" ${(plan.orphans || []).length ? 'open' : ''}>
            <summary style="padding:.7rem;cursor:pointer;color:#b45309;font-weight:600;">Unreferenced remote objects (${(plan.orphans || []).length})</summary>
            <div style="max-height:240px;overflow:auto;border-top:1px solid #e2e8f0;">${orphanRows || '<div style="padding:.7rem;color:#64748b;">None</div>'}</div>
        </details>`;
    const markerRows = (plan.directoryMarkers || []).map((_: any, index: number) => `
        <label style="display:flex;align-items:flex-start;gap:.6rem;padding:.6rem .7rem;border-bottom:1px solid #f1f5f9;cursor:pointer;">
            <input data-r2-marker-index="${index}" type="checkbox" style="margin-top:.15rem;accent-color:#16a34a;" />
            <span style="min-width:0;"><code style="display:block;font-size:.72rem;word-break:break-all;color:#475569;"></code><small style="color:#94a3b8;">Delete marker only; prefixed photos remain.</small></span>
        </label>`).join('');
    const markerList = (plan.directoryMarkers || []).length ? `
        <details style="margin-top:.75rem;border:1px solid #e2e8f0;border-radius:7px;overflow:hidden;">
            <summary style="padding:.7rem;cursor:pointer;color:#64748b;font-weight:600;">Empty folder markers (${plan.directoryMarkers.length})</summary>
            <div style="max-height:240px;overflow:auto;border-top:1px solid #e2e8f0;">${markerRows}</div>
        </details>` : '';
    dialog.innerHTML = `
        <div style="display:flex;flex-direction:column;width:min(780px,92vw);max-height:84vh;background:white;border-radius:12px;overflow:hidden;font-family:sans-serif;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid #e2e8f0;background:#fafafa;">
                <h3 style="margin:0;font-size:1rem;color:#334155;">R2 Manager</h3>
                <div class="dev-manager-header-actions">
                    <button data-r2-save class="dev-manager-header-button dev-manager-header-button--save" type="button" disabled title="No staged objects">${ICONS.check}</button>
                    <button data-r2-close class="dev-manager-header-button" type="button">${ICONS.close}</button>
                </div>
            </div>
            <div style="overflow:auto;padding:1rem 1.25rem;">
                ${plan.remoteAvailable ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;"><div>Source<br><strong>${plan.sourceCount}</strong></div><div>Remote<br><strong>${plan.remoteCount}</strong></div><div>Storage<br><strong>${formatBytes(plan.remoteBytes)}</strong></div></div>` : `<p style="padding:.75rem;background:#fff7ed;color:#9a3412;border-radius:6px;">${plan.message}</p>`}
                ${plan.remoteAvailable ? readonlyList('Source missing in R2', plan.sourceMissing || [], '#b91c1c', 'missing') + orphanList + markerList + readonlyList('Trash', plan.trash || [], '#475569', 'trash') : ''}
            </div>
        </div>`;
    if (plan.remoteAvailable) {
        const groups: Record<string, any[]> = { missing: plan.sourceMissing || [], trash: plan.trash || [] };
        dialog.querySelectorAll('[data-r2-group]').forEach((row) => {
            const element = row as HTMLElement;
            const item = groups[element.dataset.r2Group || '']?.[Number(element.dataset.r2Index)];
            if (item) row.textContent = item.key;
        });
        dialog.querySelectorAll('[data-r2-orphan-index]').forEach((input) => {
            const index = Number((input as HTMLInputElement).dataset.r2OrphanIndex);
            const code = input.parentElement?.querySelector('code');
            if (code) code.textContent = plan.orphans[index].key;
        });
        dialog.querySelectorAll('[data-r2-marker-index]').forEach((input) => {
            const index = Number((input as HTMLInputElement).dataset.r2MarkerIndex);
            const code = input.parentElement?.querySelector('code');
            if (code) code.textContent = plan.directoryMarkers[index].key;
        });
    }
    document.body.appendChild(dialog);
    const saveBtn = dialog.querySelector('[data-r2-save]') as HTMLButtonElement;
    const closeBtn = dialog.querySelector('[data-r2-close]') as HTMLButtonElement;
    const selected = new Set<number>();
    const selectedMarkers = new Set<number>();
    const updateDirtyState = () => {
        const count = selected.size + selectedMarkers.size;
        saveBtn.disabled = count === 0;
        saveBtn.title = count ? `Apply ${count} staged R2 cleanup action(s)` : 'No staged objects';
    };
    dialog.querySelectorAll('[data-r2-orphan-index]').forEach((input) => {
        input.addEventListener('change', () => {
            const checkbox = input as HTMLInputElement;
            const index = Number(checkbox.dataset.r2OrphanIndex);
            if (checkbox.checked) selected.add(index);
            else selected.delete(index);
            updateDirtyState();
        });
    });
    dialog.querySelectorAll('[data-r2-marker-index]').forEach((input) => {
        input.addEventListener('change', () => {
            const checkbox = input as HTMLInputElement;
            const index = Number(checkbox.dataset.r2MarkerIndex);
            if (checkbox.checked) selectedMarkers.add(index);
            else selectedMarkers.delete(index);
            updateDirtyState();
        });
    });
    closeBtn.addEventListener('click', () => {
        if ((selected.size || selectedMarkers.size) && !confirm('Discard staged R2 cleanup changes?')) return;
        dialog.close();
    });
    saveBtn.addEventListener('click', async () => {
        if (!selected.size && !selectedMarkers.size) return;
        saveBtn.disabled = true;
        saveBtn.textContent = '…';
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 45_000);
        try {
            const objects = [...selected].map((index) => ({
                key: plan.orphans[index].key,
                etag: plan.orphans[index].etag,
            }));
            const markers = [...selectedMarkers].map((index) => ({
                key: plan.directoryMarkers[index].key,
                etag: plan.directoryMarkers[index].etag,
            }));
            const trashResponse = await fetch('/api/r2-trash-objects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ objects, markers }),
                signal: controller.signal,
            });
            const result = await trashResponse.json().catch(() => ({}));
            if (!trashResponse.ok) throw new Error(result.error || 'R2 Trash operation failed');
            dialog.close();
            showToast(`✅ Applied ${result.results?.length || objects.length + markers.length} R2 cleanup action(s)`);
            void openR2Manager();
        } catch (error: any) {
            if (error?.name === 'AbortError') {
                dialog.close();
                showToast('⌛ R2 response timed out; refreshing the remote audit…');
                window.setTimeout(() => void openR2Manager(), 1500);
                return;
            }
            showToast(`❌ ${error?.message || 'R2 Trash operation failed'}`);
            saveBtn.innerHTML = ICONS.check;
            updateDirtyState();
        } finally {
            window.clearTimeout(timeout);
        }
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
}
