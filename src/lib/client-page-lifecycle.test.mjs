import assert from "node:assert/strict";
import test from "node:test";

import { installPageLifecycle } from "./client-page-lifecycle.ts";

test("page loads replace the active mount and clean up the previous mount once", () => {
    const events = new EventTarget();
    let mountCount = 0;
    const cleanupCounts = [];

    installPageLifecycle(events, () => {
        const mountIndex = mountCount;
        mountCount += 1;
        cleanupCounts[mountIndex] = 0;

        return () => {
            cleanupCounts[mountIndex] += 1;
        };
    });

    events.dispatchEvent(new Event("astro:page-load"));
    events.dispatchEvent(new Event("astro:page-load"));

    assert.equal(mountCount, 2);
    assert.deepEqual(cleanupCounts, [1, 0]);
});

test("before-swap and uninstall are idempotent, and uninstall removes listeners", () => {
    const events = new EventTarget();
    let mountCount = 0;
    let cleanupCount = 0;

    const uninstall = installPageLifecycle(events, () => {
        mountCount += 1;

        return () => {
            cleanupCount += 1;
        };
    });

    events.dispatchEvent(new Event("astro:page-load"));
    events.dispatchEvent(new Event("astro:before-swap"));
    events.dispatchEvent(new Event("astro:before-swap"));
    assert.equal(cleanupCount, 1);

    events.dispatchEvent(new Event("astro:page-load"));
    uninstall();
    uninstall();
    assert.equal(cleanupCount, 2);

    events.dispatchEvent(new Event("astro:page-load"));
    events.dispatchEvent(new Event("astro:before-swap"));
    assert.equal(mountCount, 2);
    assert.equal(cleanupCount, 2);
});
