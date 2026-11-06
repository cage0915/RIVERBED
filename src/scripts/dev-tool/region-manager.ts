import { DEFAULT_MOUNTAIN_VIEW_SETTINGS, type MountainViewSettings } from "../../lib/mountains/view-settings";
import { ICONS, showToast, escapeHtml, loadSortable } from "./ui";

// Region Manager
export async function openRegionManager() {
    showToast("⌛ Loading regions...");
    const response = await fetch("/api/mountain-regions", {
        cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        return showToast(`❌ ${data.error || "Failed to load regions"}`);
    }
    const Sortable = (window as any).Sortable
        ? (window as any).Sortable
        : await loadSortable();

    document.getElementById("dev-region-manager")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "dev-region-manager";
    dialog.style.cssText = `
        border:none;border-radius:12px;padding:0;
        box-shadow:0 20px 50px rgba(0,0,0,0.3);overflow:hidden;
    `;
    dialog.innerHTML = `
        <div style="display:flex;flex-direction:column;width:560px;max-width:92vw;max-height:80vh;background:#fff;font-family:sans-serif;">
            <header style="display:flex;align-items:center;justify-content:space-between;padding:0.65rem 1rem;border-bottom:1px solid #e5e7eb;background:#fafafa;">
                <h3 style="margin:0;color:#333;font-size:1rem;">Region Manager</h3>
                <div class="dev-manager-header-actions">
                    <button type="button" data-region-action="add" class="dev-manager-header-button" title="Add Region" aria-label="Add Region">${ICONS.plus}</button>
                    <button type="button" data-region-action="save" class="dev-manager-header-button dev-manager-header-button--save" title="No pending changes" aria-label="Save Regions" disabled>${ICONS.check}</button>
                    <button type="button" data-region-action="close" class="dev-manager-header-button" title="Close" aria-label="Close">${ICONS.close}</button>
                </div>
            </header>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0.55rem 1rem;border-bottom:1px solid #e5e7eb;background:#f8fafc;">
                <label for="dev-region-tag-columns" style="color:#475569;font-size:0.78rem;">Tags per row</label>
                <input id="dev-region-tag-columns" data-region-setting="tagColumns" type="number" min="1" max="8" step="1" value="${Number(data.settings?.tagColumns) || DEFAULT_MOUNTAIN_VIEW_SETTINGS.tagColumns}" style="width:5rem;padding:0.4rem 0.55rem;border:1px solid #cbd5e1;border-radius:5px;background:#fff;color:#334155;text-align:center;" />
            </div>
            <div data-region-list style="display:flex;flex-direction:column;gap:0.4rem;overflow-y:auto;padding:0.75rem 1rem;"></div>
        </div>
    `;
    document.body.appendChild(dialog);

    const originalIds = new Set<string>(
        (data.regions || []).map((region: { id: string }) => region.id),
    );
    let regions: { id: string; label: string }[] = (data.regions || []).map(
        (region: { id: string; label: string }) => ({ ...region }),
    );
    const settings: MountainViewSettings = {
        tagColumns:
            Number(data.settings?.tagColumns) ||
            DEFAULT_MOUNTAIN_VIEW_SETTINGS.tagColumns,
    };
    let selectedRegion: number | null = null;
    let didDragRegion = false;
    const list = dialog.querySelector<HTMLElement>("[data-region-list]")!;
    const saveRegionBtn = dialog.querySelector<HTMLButtonElement>('[data-region-action="save"]')!;
    const initialRegionSnapshot = JSON.stringify({ regions, settings });
    const updateRegionDirtyState = () => {
        const dirty = JSON.stringify({ regions, settings }) !== initialRegionSnapshot;
        saveRegionBtn.disabled = !dirty;
        saveRegionBtn.title = dirty ? 'Save Regions' : 'No pending changes';
    };

    const render = () => {
        list.innerHTML = regions.map((region, index) => `
            <div data-region-index="${index}" style="position:relative;display:grid;grid-template-columns:2.5rem minmax(0,1fr) 2rem;gap:0.45rem;align-items:center;padding:0.45rem;border:1px solid #e2e8f0;border-radius:8px;background:${selectedRegion === index ? "#eff6ff" : "#f8fafc"};outline:${selectedRegion === index ? "2px solid #2563eb" : "none"};outline-offset:1px;">
                ${selectedRegion === index
                    ? `<button type="button" data-region-action="select" title="Cancel move" style="display:flex;height:2rem;align-items:center;justify-content:center;border:0;background:none;color:#2563eb;cursor:pointer;">${ICONS.drag}</button>`
                    : `<button type="button" data-region-action="select" title="Click to move" style="display:flex;height:2rem;align-items:center;justify-content:center;border:0;background:none;color:#94a3b8;cursor:pointer;">${ICONS.drag}</button>`}
                <div style="display:grid;grid-template-columns:minmax(0,0.8fr) minmax(0,1.2fr);gap:0.5rem;min-width:0;">
                    <input data-region-field="id" value="${escapeHtml(region.id)}" ${originalIds.has(region.id) ? "readonly" : ""} placeholder="Region ID" aria-label="Region ID" style="min-width:0;padding:0.35rem 0.5rem;border:1px solid #cbd5e1;border-radius:5px;background:${originalIds.has(region.id) ? "#f1f5f9" : "#fff"};color:#334155;" />
                    <input data-region-field="label" value="${escapeHtml(region.label)}" placeholder="Region label" aria-label="Region label" style="min-width:0;padding:0.35rem 0.5rem;border:1px solid #cbd5e1;border-radius:5px;background:#fff;color:#334155;" />
                </div>
                <button type="button" data-region-action="delete" title="Delete region" style="display:flex;height:2rem;align-items:center;justify-content:center;border:0;border-radius:5px;background:#fee2e2;color:#dc2626;cursor:pointer;">${ICONS.trash}</button>
                ${selectedRegion !== null && index === 0 ? `<div class="dev-pm-inline-add-zone dev-pm-inline-add-zone--before is-active"><button type="button" class="dev-pm-inline-add-button" data-region-action="move-gap" data-region-gap-index="0" title="Move here">${ICONS.arrowRight}</button></div>` : ''}
                ${selectedRegion !== null ? `<div class="dev-pm-inline-add-zone is-active"><button type="button" class="dev-pm-inline-add-button" data-region-action="move-gap" data-region-gap-index="${index + 1}" title="Move here">${ICONS.arrowRight}</button></div>` : ''}
            </div>
        `).join("");
        updateRegionDirtyState();
    };

    list.addEventListener("input", (event) => {
        const input = event.target as HTMLInputElement;
        const row = input.closest<HTMLElement>("[data-region-index]");
        const index = Number(row?.dataset.regionIndex);
        const field = input.dataset.regionField as "id" | "label" | undefined;
        if (!Number.isInteger(index) || !field) return;
        regions[index][field] = input.value;
        updateRegionDirtyState();
    });
    dialog
        .querySelector<HTMLInputElement>("[data-region-setting='tagColumns']")
        ?.addEventListener("input", (event) => {
            settings.tagColumns = Number(
                (event.target as HTMLInputElement).value,
            );
            updateRegionDirtyState();
        });

    dialog.addEventListener("click", async (event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>(
            "button[data-region-action]",
        );
        const action = button?.dataset.regionAction;
        if (!action) return;
        if (action === "close") {
            if (!saveRegionBtn.disabled && !confirm('Discard unsaved Region Manager changes?')) return;
            return dialog.close();
        }
        if (action === "add") {
            regions.push({ id: "", label: "" });
            render();
            list.querySelector<HTMLInputElement>(
                '[data-region-index]:last-child input[data-region-field="id"]',
            )?.focus();
            return;
        }
        if (action === "save") {
            button!.disabled = true;
            const saveResponse = await fetch("/api/mountain-regions", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ regions, settings }),
            });
            const result = await saveResponse.json().catch(() => ({}));
            if (!saveResponse.ok) {
                button!.disabled = false;
                return showToast(`❌ ${result.error || "Save failed"}`);
            }
            showToast("✅ Regions updated");
            dialog.close();
            window.setTimeout(() => window.location.reload(), 300);
            return;
        }

        if (action === "move-gap" && selectedRegion !== null) {
            const gapIndex = Number(button?.dataset.regionGapIndex);
            if (!Number.isInteger(gapIndex)) return;
            const from = selectedRegion;
            const [moved] = regions.splice(from, 1);
            const target = from < gapIndex ? gapIndex - 1 : gapIndex;
            regions.splice(target, 0, moved);
            selectedRegion = null;
            render();
            return;
        }

        const row = button?.closest<HTMLElement>("[data-region-index]");
        const index = Number(row?.dataset.regionIndex);
        if (!Number.isInteger(index)) return;
        if (action === "select") {
            if (didDragRegion) {
                didDragRegion = false;
                return;
            }
            selectedRegion = selectedRegion === index ? null : index;
        }
        if (action === "delete") {
            regions.splice(index, 1);
            selectedRegion = null;
        }
        render();
    });

    const sortable = new (Sortable as any)(list, {
        animation: 150,
        ghostClass: "dev-pm-ghost",
        handle: '[data-region-action="select"]',
        onStart: () => {
            didDragRegion = true;
        },
        onEnd: (event: { oldIndex?: number; newIndex?: number }) => {
            const from = event.oldIndex;
            const to = event.newIndex;
            if (from === undefined || to === undefined || from === to) {
                didDragRegion = false;
                return;
            }
            const [moved] = regions.splice(from, 1);
            regions.splice(to, 0, moved);
            selectedRegion = null;
            window.setTimeout(() => {
                render();
                didDragRegion = false;
            }, 0);
        },
    });

    dialog.addEventListener("close", () => {
        sortable.destroy();
        dialog.remove();
    }, { once: true });
    render();
    dialog.showModal();
}
