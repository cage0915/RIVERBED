import assert from "node:assert/strict";
import test from "node:test";

import { buildPeakFinderEmbedUrl } from "./mountain-panorama.ts";

test("PeakFinder URLs preserve the viewpoint and optional initial direction", () => {
    const url = new URL(
        buildPeakFinderEmbedUrl({
            latitude: 24.458196,
            longitude: 121.258157,
            mountainName: "大霸尖山",
            elevation: 3492,
            panorama: {
                provider: "peakfinder",
                azimuth: 180,
                altitude: 2,
                fieldOfView: 45,
            },
        }),
    );

    assert.equal(url.origin, "https://www.peakfinder.com");
    assert.equal(url.pathname, "/embed/");
    assert.equal(url.searchParams.get("lat"), "24.458196");
    assert.equal(url.searchParams.get("lng"), "121.258157");
    assert.equal(url.searchParams.get("name"), "大霸尖山");
    assert.equal(url.searchParams.get("ele"), "3492");
    assert.equal(url.searchParams.get("azi"), "180");
    assert.equal(url.searchParams.get("alt"), "2");
    assert.equal(url.searchParams.get("fov"), "45");
});

test("PeakFinder URLs ignore invalid optional view settings", () => {
    const url = new URL(
        buildPeakFinderEmbedUrl({
            latitude: 36.758611,
            longitude: 137.758611,
            mountainName: "白馬岳",
            elevation: 2932,
            panorama: {
                provider: "peakfinder",
                azimuth: 500,
                altitude: -50,
                fieldOfView: 2,
            },
        }),
    );

    assert.equal(url.searchParams.has("azi"), false);
    assert.equal(url.searchParams.has("alt"), false);
    assert.equal(url.searchParams.has("fov"), false);
});

test("PeakFinder URLs reject invalid coordinates", () => {
    assert.throws(() =>
        buildPeakFinderEmbedUrl({
            latitude: 91,
            longitude: 0,
            mountainName: "Invalid",
            panorama: { provider: "peakfinder" },
        }),
    );
});
