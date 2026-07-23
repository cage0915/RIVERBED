import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { sanitizeMountainEntry } from "./mountain-editor.ts";
import { parseMountain } from "./mountain-schema.ts";

const contexts = new Set(["tw-dabajian"]);

test("mountain editor stores panorama as a boolean and omits lookup metadata", () => {
    assert.deepEqual(
        sanitizeMountainEntry(
            {
                name: " 大霸尖山 ",
                alternateName: " Papak Waqa ",
                elevation: "3492",
                description: " 測試描述 ",
                location: {
                    latitude: "24.458196",
                    longitude: "121.258157",
                    mapContext: "tw-dabajian",
                    initialBounds: {
                        west: 120.9,
                        south: 24.15,
                        east: 121.48,
                        north: 24.72,
                    },
                },
                panorama: true,
                dataSource: {
                    wikidataId: "Q706556",
                    retrievedAt: "2026-07-14T00:00:00.000Z",
                },
            },
            contexts,
        ),
        {
            name: "大霸尖山",
            alternateName: "Papak Waqa",
            elevation: 3492,
            description: "測試描述",
            location: {
                latitude: 24.458196,
                longitude: 121.258157,
                mapContext: "tw-dabajian",
                initialBounds: {
                    west: 120.9,
                    south: 24.15,
                    east: 121.48,
                    north: 24.72,
                },
            },
            panorama: true,
        },
    );
});

test("mountain editor preserves an explicitly disabled panorama", () => {
    assert.deepEqual(
        sanitizeMountainEntry(
            {
                name: "山",
                elevation: null,
                description: "",
                panorama: false,
            },
            contexts,
        ),
        {
            name: "山",
            elevation: null,
            description: "",
            panorama: false,
        },
    );
});

test("mountain editor rounds elevations and coordinates to storage precision", () => {
    const mountain = sanitizeMountainEntry(
        {
            name: "山",
            elevation: 1234.6,
            description: "",
            location: {
                latitude: 24.1234567,
                longitude: 121.7654326,
                mapContext: "tw-dabajian",
            },
        },
        contexts,
    );
    assert.equal(mountain.elevation, 1235);
    assert.deepEqual(mountain.location, {
        latitude: 24.123457,
        longitude: 121.765433,
        mapContext: "tw-dabajian",
    });
});

test("mountain editor allows panorama to default on before location is added", () => {
    assert.deepEqual(
        sanitizeMountainEntry(
            {
                name: "山",
                elevation: null,
                description: "",
                panorama: true,
            },
            contexts,
        ),
        {
            name: "山",
            elevation: null,
            description: "",
            panorama: true,
        },
    );
});

test("mountain editor rejects unknown contexts and incomplete coordinates", () => {
    assert.throws(() =>
        sanitizeMountainEntry(
            {
                name: "山",
                elevation: null,
                description: "",
                location: { latitude: 24, longitude: 121, mapContext: "missing" },
            },
            contexts,
        ),
    );
    assert.throws(() =>
        sanitizeMountainEntry(
            {
                name: "山",
                elevation: null,
                description: "",
                location: { latitude: 24, mapContext: "tw-dabajian" },
            },
            contexts,
        ),
    );
});

test("mountain editor accepts cover photos from any album folder", () => {
    assert.deepEqual(
        sanitizeMountainEntry(
            {
                name: "山",
                elevation: null,
                description: "",
                coverKey: "y/2026-keelungyu/KCS00128.jpg",
            },
            contexts,
        ),
        {
            name: "山",
            elevation: null,
            description: "",
            coverKey: "y/2026-keelungyu/KCS00128.jpg",
        },
    );
});

test("mountain editor output satisfies the canonical stored schema", () => {
    const result = sanitizeMountainEntry(
        {
            name: " 山 ",
            elevation: "1234.6",
            description: " 描述 ",
            location: {
                latitude: "24.1234567",
                longitude: "121.7654326",
                mapContext: "tw-dabajian",
            },
            panorama: false,
            dataSource: { wikidataId: "Q1" },
        },
        contexts,
    );

    assert.deepEqual(parseMountain(result, contexts), result);
});

test("mountain editor delegates the stored contract to mountain-schema", () => {
    const source = fs.readFileSync(
        new URL("./mountain-editor.ts", import.meta.url),
        "utf8",
    );
    assert.match(source, /parseMountain/);
    assert.doesNotMatch(source, /export type EditableMountain/);
});
