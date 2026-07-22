import assert from "node:assert/strict";
import test from "node:test";

import { createCoverSaveQueue, isCoverDraftCurrent, settleCoverSave } from "./dev-cover-state.js";

const persisted = {
    state: { albumSlug: "yama/a", coverKey: "yama/a/old.jpg", zoom: 1, x: 50, y: 40 },
    imageSrc: "/r2/yama/a/old.jpg",
};

test("failed cover saves restore the persisted key, crop, and image", () => {
    assert.deepEqual(settleCoverSave(persisted, null), persisted);
});

test("successful cover saves adopt the server-resolved state and current image", () => {
    assert.deepEqual(settleCoverSave(persisted, {
        coverKey: "yama/source/shared.jpg",
        coverZoom: 1.2,
        coverOffset: { x: 40, y: 60 },
    }, "/r2/yama/source/shared.jpg"), {
        state: {
            albumSlug: "yama/a",
            coverKey: "yama/source/shared.jpg",
            zoom: 1.2,
            x: 40,
            y: 60,
        },
        imageSrc: "/r2/yama/source/shared.jpg",
    });
});

test("cover save queue finishes an older failure before a newer save can commit", async () => {
    const enqueue = createCoverSaveQueue();
    const card = {};
    const events = [];
    let releaseOlder;
    const olderMayFinish = new Promise((resolve) => { releaseOlder = resolve; });
    const older = enqueue(card, async () => {
        events.push("older:start");
        await olderMayFinish;
        events.push("older:fail");
        throw new Error("network failure");
    });
    const newer = enqueue(card, async () => {
        events.push("newer:start");
        events.push("newer:success");
        return "saved";
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["older:start"]);
    releaseOlder();
    await assert.rejects(older, /network failure/);
    assert.equal(await newer, "saved");
    assert.deepEqual(events, ["older:start", "older:fail", "newer:start", "newer:success"]);
});

test("an older save does not own UI state after a newer draft changes key, crop, or image", () => {
    const draft = persisted.state;
    assert.equal(isCoverDraftCurrent(draft, persisted.imageSrc, draft, persisted.imageSrc), true);
    assert.equal(isCoverDraftCurrent(
        { ...draft, x: 60 },
        "/r2/yama/a/newer.jpg",
        draft,
        persisted.imageSrc,
    ), false);
    const saved = settleCoverSave(persisted, {
        coverKey: draft.coverKey,
        coverZoom: draft.zoom,
        coverOffset: { x: draft.x, y: draft.y },
    }, persisted.imageSrc);
    assert.equal(saved.imageSrc, persisted.imageSrc);
});

test("older success followed by queued newer failure restores the exact older key, crop, and image", () => {
    const draftA = { ...persisted.state, coverKey: "yama/a/a.jpg", x: 45 };
    const imageA = "/r2/yama/a/a.jpg";
    const draftB = { ...draftA, coverKey: "yama/a/b.jpg", zoom: 1.4, x: 70 };
    const imageB = "/r2/yama/a/b.jpg";

    assert.equal(isCoverDraftCurrent(draftB, imageB, draftA, imageA), false);
    const savedA = settleCoverSave(persisted, {
        coverKey: draftA.coverKey,
        coverZoom: draftA.zoom,
        coverOffset: { x: draftA.x, y: draftA.y },
    }, imageA);
    assert.equal(isCoverDraftCurrent(draftB, imageB, draftB, imageB), true);
    const restoredAfterBFailure = settleCoverSave(savedA, null);

    assert.deepEqual(restoredAfterBFailure, {
        state: draftA,
        imageSrc: imageA,
    });
});
