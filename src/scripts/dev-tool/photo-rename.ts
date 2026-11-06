import { ICONS, showToast, escapeHtml } from "./ui";

export async function openPhotoRenameDryRun(
    albumSlug: string,
    orderedKeys: string[],
    onRenamed: (renamed: Record<string, string>) => void,
) {
    showToast('⌛ Building rename dry run...');
    const response = await fetch('/api/rename-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumSlug, orderedKeys, dryRun: true }),
    });
    const plan = await response.json().catch(() => ({}));
    if (!response.ok) return showToast(`❌ ${plan.error || 'Unable to build rename plan'}`);

    const items = (plan.items || []) as Array<{
        oldName: string;
        newName: string;
        status: 'rename' | 'unchanged' | 'missing' | 'conflict' | 'duplicate';
    }>;
    const statusMeta = {
        rename: { label: 'Rename', color: '#2563eb', background: '#eff6ff' },
        unchanged: { label: 'Unchanged', color: '#64748b', background: '#f8fafc' },
        missing: { label: 'Missing', color: '#b91c1c', background: '#fef2f2' },
        conflict: { label: 'Conflict', color: '#b91c1c', background: '#fef2f2' },
        duplicate: { label: 'Duplicate', color: '#b91c1c', background: '#fef2f2' },
    };
    const issueCount = items.filter((item) => ['missing', 'conflict', 'duplicate'].includes(item.status)).length;
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'border:0;border-radius:12px;padding:0;box-shadow:0 20px 50px rgba(0,0,0,.3);';
    dialog.innerHTML = `
        <div style="display:flex;flex-direction:column;width:min(720px,92vw);max-height:82vh;background:white;border-radius:12px;overflow:hidden;font-family:sans-serif;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid #e2e8f0;background:#fafafa;">
                <div><h3 style="margin:0;font-size:1rem;color:#334155;">Rename Photos Dry Run</h3><div style="font-size:.72rem;color:#64748b;margin-top:.2rem;">${escapeHtml(albumSlug)} · ${plan.renameCount} rename${plan.renameCount === 1 ? '' : 's'}</div></div>
                <div class="dev-manager-header-actions">
                    <button data-rename-action="save" class="dev-manager-header-button dev-manager-header-button--save" type="button" ${plan.canExecute ? '' : 'disabled'} title="${plan.canExecute ? `Execute ${plan.renameCount} renames` : 'No executable rename plan'}">${ICONS.check}</button>
                    <button data-rename-action="close" class="dev-manager-header-button" type="button">${ICONS.close}</button>
                </div>
            </div>
            <div style="overflow:auto;padding:1rem 1.25rem;">
                ${issueCount ? `<p style="margin:0 0 .75rem;padding:.75rem;background:#fef2f2;color:#b91c1c;border-radius:6px;">Resolve ${issueCount} blocking issue${issueCount === 1 ? '' : 's'} before renaming.</p>` : ''}
                <div style="border:1px solid #e2e8f0;border-radius:7px;overflow:hidden;">
                    ${items.map((item) => {
                        const meta = statusMeta[item.status];
                        return `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto;align-items:center;gap:.65rem;padding:.55rem .75rem;border-top:1px solid #edf2f7;font-size:.75rem;">
                            <code style="overflow:hidden;color:#475569;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(item.oldName)}">${escapeHtml(item.oldName)}</code>
                            <span style="color:#94a3b8;">→</span>
                            <code style="overflow:hidden;color:#475569;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(item.newName)}">${escapeHtml(item.newName)}</code>
                            <span style="padding:.18rem .4rem;border-radius:999px;background:${meta.background};color:${meta.color};font-size:.65rem;">${meta.label}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        </div>`;
    document.body.appendChild(dialog);
    const saveBtn = dialog.querySelector('[data-rename-action="save"]') as HTMLButtonElement;
    dialog.querySelector('[data-rename-action="close"]')?.addEventListener('click', () => dialog.close());
    saveBtn.addEventListener('click', async () => {
        if (!confirm(`Execute ${plan.renameCount} photo renames?`)) return;
        saveBtn.disabled = true;
        saveBtn.textContent = '…';
        const executeResponse = await fetch('/api/rename-photos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ albumSlug, orderedKeys, dryRun: false }),
        });
        const result = await executeResponse.json().catch(() => ({}));
        if (!executeResponse.ok) {
            saveBtn.innerHTML = ICONS.check;
            saveBtn.disabled = !plan.canExecute;
            return showToast(`❌ ${result.error || 'Rename failed'}`);
        }
        onRenamed(result.renamed || {});
        showToast(`✅ Renamed ${Object.keys(result.renamed || {}).length} photos`);
        dialog.close();
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
}
