import assert from "node:assert/strict";
import test from "node:test";

import { getMountainContextReferences } from "./mountain-context-lifecycle.ts";

test("finds Mountains that prevent a referenced context from being deleted", () => {
    const mountains = [
        {
            name: "山一",
            elevation: 1000,
            description: "",
            region: "taiwan",
            location: { latitude: 24, longitude: 121, mapContext: "tw-mainland" },
        },
        {
            name: "山二",
            elevation: null,
            description: "",
            region: "taiwan",
        },
        {
            name: "山三",
            elevation: 2000,
            description: "",
            region: "japan",
            location: { latitude: 36, longitude: 138, mapContext: "jp-honshu" },
        },
    ];

    assert.deepEqual(
        getMountainContextReferences(mountains, "tw-mainland"),
        ["山一"],
    );
    assert.deepEqual(getMountainContextReferences(mountains, "unused"), []);
});
