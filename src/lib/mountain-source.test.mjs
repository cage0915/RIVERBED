import assert from "node:assert/strict";
import test from "node:test";

import { parseMountainRegionSource } from "./mountain-source.ts";

const contexts = new Set(["tw-mainland"]);

test("parses a valid Mountain region source", () => {
    assert.deepEqual(
        parseMountainRegionSource(
            [{ name: "山", elevation: null, description: "" }],
            "/src/mountains/taiwan.json",
            contexts,
        ),
        [{ name: "山", elevation: null, description: "" }],
    );
});

test("source errors identify path and array index", () => {
    assert.throws(
        () =>
            parseMountainRegionSource(
                [
                    { name: "山一", elevation: null, description: "" },
                    { name: "山二", elevation: "bad", description: "" },
                ],
                "/src/mountains/taiwan.json",
                contexts,
            ),
        /Invalid Mountain source \/src\/mountains\/taiwan\.json.*Mountain entry 1.*elevation/is,
    );
});
