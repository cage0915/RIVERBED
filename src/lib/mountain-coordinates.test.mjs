import assert from "node:assert/strict";
import test from "node:test";

import { parseDirectionalCoordinates } from "./mountain-coordinates.ts";

test("parses north/east coordinates copied with degree symbols", () => {
    assert.deepEqual(parseDirectionalCoordinates("24.36170°N, 121.43899°E"), {
        latitude: 24.3617,
        longitude: 121.43899,
    });
});

test("applies south/west directions and tolerates spacing and letter case", () => {
    assert.deepEqual(parseDirectionalCoordinates(" 24.5 ° s, 121.25° w "), {
        latitude: -24.5,
        longitude: -121.25,
    });
});

test("rejects unsupported and out-of-range coordinates", () => {
    assert.equal(parseDirectionalCoordinates("24.36170, 121.43899"), null);
    assert.equal(parseDirectionalCoordinates("91°N, 121°E"), null);
    assert.equal(parseDirectionalCoordinates("24°N, 181°E"), null);
});
