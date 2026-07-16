import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_MOUNTAIN_VIEW_SETTINGS,
    sanitizeMountainViewSettings,
} from "./mountain-view-settings.ts";

test("mountain tags view defaults to five columns", () => {
    assert.deepEqual(DEFAULT_MOUNTAIN_VIEW_SETTINGS, { tagColumns: 5 });
});

test("mountain tags view accepts a shared column count from one to eight", () => {
    assert.deepEqual(sanitizeMountainViewSettings({ tagColumns: 7 }), {
        tagColumns: 7,
    });
    assert.throws(() => sanitizeMountainViewSettings({ tagColumns: 0 }));
    assert.throws(() => sanitizeMountainViewSettings({ tagColumns: 9 }));
    assert.throws(() => sanitizeMountainViewSettings({ tagColumns: 3.5 }));
});
