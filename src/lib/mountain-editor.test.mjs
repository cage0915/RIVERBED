import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeMountainEntry } from "./mountain-editor.ts";

const contexts = new Set(["tw-dabajian"]);

test("mountain editor sanitizes provider-neutral map and panorama settings", () => {
    assert.deepEqual(
        sanitizeMountainEntry(
            {
                name: " 大霸尖山 ",
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
                panorama: {
                    provider: "peakfinder",
                    azimuth: "180",
                    altitude: "0",
                    fieldOfView: "45",
                },
                dataSource: {
                    wikidataId: "Q706556",
                    retrievedAt: "2026-07-14T00:00:00.000Z",
                },
            },
            contexts,
        ),
        {
            name: "大霸尖山",
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
            panorama: {
                provider: "peakfinder",
                azimuth: 180,
                altitude: 0,
                fieldOfView: 45,
            },
            dataSource: {
                wikidataId: "Q706556",
            },
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
