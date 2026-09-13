import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readProjectFile = (path) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const fontImports = (source) =>
    Array.from(
        source.matchAll(
            /["'](@fontsource\/(?:noto-sans-(?:jp|tc)|pt-sans)\/[^"']+\.css)["']/g,
        ),
        (match) => match[1],
    ).sort();

test("global and route font weights stay scoped to actual use", () => {
    const layout = readProjectFile("src/layouts/Layout.astro");
    const home = readProjectFile("src/pages/index.astro");
    const folder = readProjectFile("src/pages/[folder]/index.astro");
    const album = readProjectFile("src/pages/[folder]/[album].astro");
    const tagIndex = readProjectFile("src/pages/yama/tags/index.astro");
    const tagDetail = readProjectFile("src/pages/yama/tags/[tag].astro");

    assert.deepEqual(fontImports(layout), [
        "@fontsource/noto-sans-jp/400.css",
        "@fontsource/noto-sans-tc/400.css",
        "@fontsource/pt-sans/400.css",
    ]);
    assert.deepEqual(fontImports(home), []);
    assert.deepEqual(fontImports(tagIndex), []);
    assert.deepEqual(fontImports(folder), [
        "@fontsource/noto-sans-jp/300.css",
        "@fontsource/noto-sans-tc/300.css",
    ]);
    assert.deepEqual(fontImports(album), [
        "@fontsource/noto-sans-jp/300.css",
        "@fontsource/noto-sans-jp/700.css",
        "@fontsource/noto-sans-tc/300.css",
        "@fontsource/noto-sans-tc/700.css",
    ]);
    assert.deepEqual(fontImports(tagDetail), [
        "@fontsource/noto-sans-jp/300.css",
        "@fontsource/noto-sans-jp/500.css",
        "@fontsource/noto-sans-jp/700.css",
        "@fontsource/noto-sans-tc/300.css",
        "@fontsource/noto-sans-tc/500.css",
        "@fontsource/noto-sans-tc/700.css",
    ]);

    const allFontImports = [layout, home, folder, album, tagIndex, tagDetail]
        .flatMap(fontImports);
    assert.ok(
        allFontImports.every((path) => /\/\d+\.css$/.test(path)),
        "CJK fonts must use Fontsource's unicode-range CSS, not monolithic language files",
    );
    assert.doesNotMatch(album, /font-weight:\s*600/);
});
