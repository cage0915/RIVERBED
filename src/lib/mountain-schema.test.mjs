import assert from "node:assert/strict";
import test from "node:test";

import {
    parseMountain,
    parseMountainArray,
    parseMountainCoverKey,
} from "./mountain-schema.ts";

const contexts = new Set(["tw-mainland"]);

const valid = (overrides = {}) => ({
    name: "大霸尖山",
    alternateName: "Papak Waqa",
    elevation: 3492,
    description: "測試描述",
    coverKey: "yama/2025-trip/photo.jpg",
    location: {
        latitude: 24.458196,
        longitude: 121.258157,
        mapContext: "tw-mainland",
        initialBounds: {
            west: 120.9,
            south: 24.15,
            east: 121.48,
            north: 24.72,
        },
    },
    panorama: true,
    ...overrides,
});

test("parses canonical stored Mountains", () => {
    assert.deepEqual(parseMountain(valid(), contexts), valid());
    assert.deepEqual(
        parseMountain(
            { name: "山", elevation: null, description: "" },
            contexts,
        ),
        { name: "山", elevation: null, description: "" },
    );
});

test("rejects unknown root and nested fields", () => {
    assert.throws(
        () => parseMountain(valid({ dataSource: {} }), contexts),
        /unknown field.*dataSource/i,
    );
    assert.throws(
        () =>
            parseMountain(
                valid({
                    location: {
                        latitude: 24,
                        longitude: 121,
                        mapContext: "tw-mainland",
                        typo: true,
                    },
                }),
                contexts,
            ),
        /location.*unknown field.*typo/i,
    );
    assert.throws(
        () =>
            parseMountain(
                valid({
                    location: {
                        latitude: 24,
                        longitude: 121,
                        mapContext: "tw-mainland",
                        initialBounds: {
                            west: 120,
                            south: 23,
                            east: 122,
                            north: 25,
                            typo: 1,
                        },
                    },
                }),
                contexts,
            ),
        /initialBounds.*unknown field.*typo/i,
    );
});

test("stored parsing never coerces form values", () => {
    assert.throws(
        () => parseMountain(valid({ elevation: "3492" }), contexts),
        /elevation/i,
    );
    assert.throws(
        () => parseMountain(valid({ name: " 山 " }), contexts),
        /name/i,
    );
    assert.throws(
        () => parseMountain(valid({ panorama: "true" }), contexts),
        /panorama/i,
    );
});

test("validates constrained fields", () => {
    assert.throws(
        () => parseMountain(valid({ alternateName: "" }), contexts),
        /alternateName/i,
    );
    assert.throws(
        () =>
            parseMountain(valid({ description: "x".repeat(5001) }), contexts),
        /description/i,
    );
    assert.throws(
        () => parseMountain(valid({ elevation: 123.5 }), contexts),
        /elevation/i,
    );
    assert.throws(
        () => parseMountain(valid({ elevation: 9001 }), contexts),
        /elevation/i,
    );
    assert.throws(
        () => parseMountain(valid({ coverKey: "broken" }), contexts),
        /coverKey/i,
    );
    assert.throws(
        () =>
            parseMountain(
                valid({
                    location: {
                        latitude: 91,
                        longitude: 121,
                        mapContext: "tw-mainland",
                    },
                }),
                contexts,
            ),
        /latitude/i,
    );
    assert.throws(
        () =>
            parseMountain(
                valid({
                    location: {
                        latitude: 24,
                        longitude: 121,
                        mapContext: "missing",
                    },
                }),
                contexts,
            ),
        /mapContext/i,
    );
});

test("array errors identify the failing entry", () => {
    assert.throws(
        () =>
            parseMountainArray(
                [
                    { name: "山一", elevation: null, description: "" },
                    { name: "山二", elevation: "bad", description: "" },
                ],
                contexts,
            ),
        /Mountain entry 1.*elevation/i,
    );
});

test("parses cover keys without editor ownership", () => {
    assert.deepEqual(parseMountainCoverKey("y/2026-trip/photo.jpg"), {
        coverKey: "y/2026-trip/photo.jpg",
        folder: "y",
        albumId: "2026-trip",
        photoKey: "photo.jpg",
    });
    assert.equal(parseMountainCoverKey("broken"), null);
});
