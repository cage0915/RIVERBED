import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
    MAP_CONTEXTS,
    MAP_SOURCES,
    boundsToViewBox,
    constrainMapViewBox,
    formatViewBox,
    isPointInsideBounds,
    projectCoordinates,
    viewBoxToBounds,
    zoomMapViewBoxAt,
} from "./mountain-map.ts";

test("Web Mercator projects the origin to the centre of the world", () => {
    const point = projectCoordinates(0, 0);
    assert.equal(point.x, 5000);
    assert.equal(point.y, 5000);
});

test("view boxes use positive dimensions and contain their mountain point", () => {
    const testLocations = [
        {
            context: "tw-mainland",
            latitude: 24.458196,
            longitude: 121.258157,
        },
        {
            context: "jp-northern-alps",
            latitude: 36.758611,
            longitude: 137.758611,
        },
    ];

    for (const location of testLocations) {
        const context = MAP_CONTEXTS[location.context];
        const [, , width, height] = boundsToViewBox(context.bounds);
        assert.ok(width > 0);
        assert.ok(height > 0);
        assert.ok(
            isPointInsideBounds(
                location.latitude,
                location.longitude,
                context.bounds,
            ),
            `${location.context} should contain its mountain`,
        );
        assert.equal(formatViewBox(context.bounds).split(" ").length, 4);
    }
});

test("invalid bounds are rejected", () => {
    assert.throws(() =>
        boundsToViewBox({ west: 10, east: 5, south: 20, north: 30 }),
    );
});

test("geographic bounds survive a viewBox round trip", () => {
    const bounds = MAP_CONTEXTS["tw-mainland"].bounds;
    const roundTrip = viewBoxToBounds(boundsToViewBox(bounds));

    for (const key of ["west", "south", "east", "north"]) {
        assert.ok(Math.abs(roundTrip[key] - bounds[key]) < 1e-9);
    }
});

test("contexts only reference features present in their source SVG", () => {
    for (const context of Object.values(MAP_CONTEXTS)) {
        const source = MAP_SOURCES[context.source];
        const visibleFeatures = context.visibleFeatures ?? source.featureIds;
        const svgPath = new URL(`../../public${source.asset}`, import.meta.url);
        const svg = fs.readFileSync(svgPath, "utf8");

        for (const featureId of visibleFeatures) {
            assert.ok(source.featureIds.includes(featureId));
            assert.match(svg, new RegExp(`id="${featureId}"`));
        }
    }
});

test("every context references one existing master source", () => {
    for (const context of Object.values(MAP_CONTEXTS)) {
        assert.ok(MAP_SOURCES[context.source]);
    }
});

test("code-owned full-map contexts cover every source feature", () => {
    const protectedContexts = Object.values(MAP_CONTEXTS).filter(
        (context) => context.protected,
    );
    assert.deepEqual(
        protectedContexts.map((context) => context.id).sort(),
        ["jp-full", "tw-full"],
    );

    for (const context of protectedContexts) {
        const source = MAP_SOURCES[context.source];
        assert.equal(context.level, "country");
        assert.deepEqual(
            [...context.visibleFeatures].sort(),
            [...source.featureIds].sort(),
        );
        const viewBox = boundsToViewBox(context.bounds);
        source.extent.forEach((value, index) => {
            assert.ok(Math.abs(viewBox[index] - value) < 0.01);
        });
    }
});

test("interactive zoom keeps the requested focal point stable", () => {
    const initial = boundsToViewBox(MAP_CONTEXTS["jp-northern-alps"].bounds);
    const source = [...MAP_SOURCES.japan.extent];
    const focus = projectCoordinates(36.758611, 137.758611);
    const beforeXRatio = (focus.x - initial[0]) / initial[2];
    const beforeYRatio = (focus.y - initial[1]) / initial[3];
    const zoomed = zoomMapViewBoxAt(initial, 0.5, focus, initial, source);

    assert.equal(zoomed[2], initial[2] * 0.5);
    assert.equal(zoomed[3], initial[3] * 0.5);
    assert.ok(Math.abs((focus.x - zoomed[0]) / zoomed[2] - beforeXRatio) < 1e-9);
    assert.ok(Math.abs((focus.y - zoomed[1]) / zoomed[3] - beforeYRatio) < 1e-9);
});

test("interactive pan and zoom remain constrained to the map source", () => {
    const initial = boundsToViewBox(MAP_CONTEXTS["tw-mainland"].bounds);
    const source = [...MAP_SOURCES.taiwan.extent];
    const constrained = constrainMapViewBox(
        [-100_000, -100_000, initial[2] / 1000, initial[3] / 1000],
        initial,
        source,
    );

    assert.equal(constrained[2], initial[2] / 32);
    assert.equal(constrained[3], initial[3] / 32);
    assert.ok(constrained[0] > source[0] - source[2]);
    assert.ok(constrained[1] > source[1] - source[3]);
});
