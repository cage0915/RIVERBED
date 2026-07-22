import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createPageContent, referencedLocalNames } from './page-structure.ts';

const readProjectFile = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('production configuration builds static pages without a Workers runtime', () => {
    const astroConfig = readProjectFile('astro.config.mjs');
    const wranglerConfig = readProjectFile('wrangler.toml');
    const mountainProfile = readProjectFile('src/components/MountainProfile.astro');
    const packageJson = JSON.parse(readProjectFile('package.json'));

    assert.match(astroConfig, /output:\s*["']static["']/);
    assert.doesNotMatch(astroConfig, /@astrojs\/cloudflare/);
    assert.doesNotMatch(astroConfig, /adapter:\s*cloudflare/);
    assert.doesNotMatch(wranglerConfig, /\[\[r2_buckets\]\]/);
    assert.doesNotMatch(mountainProfile, /Astro\.locals\.runtime/);
    assert.equal(packageJson.dependencies['@astrojs/cloudflare'], undefined);
    assert.equal(packageJson.devDependencies['@cloudflare/workers-types'], undefined);
    assert.equal(packageJson.scripts['preview:r2'], undefined);
});

test('mountain navigation uses the static yama tag route hierarchy', () => {
    const mountainGrid = readProjectFile('src/components/MountainTagGrid.astro');
    const folderPage = readProjectFile('src/pages/[folder]/index.astro');
    const photo = readProjectFile('src/components/Photo.astro');
    const devTool = readProjectFile('src/components/DevTool.astro');
    const mountainDevTool = readProjectFile('src/components/MountainDevTool.astro');
    const layout = readProjectFile('src/layouts/Layout.astro');

    assert.match(mountainGrid, /\/yama\/tags\/\$\{encodeURIComponent\(mountain\.name\)\}/);
    assert.match(folderPage, /href=[{]["']\/yama\/tags["'][}]/);
    for (const source of [photo, devTool, mountainDevTool, layout]) {
        assert.doesNotMatch(source, /["'`]\/tags\//);
        assert.match(source, /\/yama\/tags\//);
    }
    assert.equal(
        existsSync(new URL('../pages/tags/[tag].astro', import.meta.url)),
        false,
    );
    assert.equal(
        existsSync(new URL('../pages/yama/tags/[tag].astro', import.meta.url)),
        true,
    );
});

test('DevTool classifies static mountain tag routes separately from albums', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /isMountainTagIndex[\s\S]*isMountainTagPage[\s\S]*from ["']\.\.\/lib\/dev-route-state\.js["']/);
    assert.match(devTool, /isMountainTagPage\(window\.location\.pathname\)/);
    assert.match(devTool, /!isMountainTagIndex\(window\.location\.pathname\)/);
    assert.doesNotMatch(devTool, /new URLSearchParams\(window\.location\.search\)\.get\('view'\) === 'tags'/);
});

test('page content preserves unrelated frontmatter while applying the draft', () => {
    const original = `---\ntitle: "Old"\npublishedAt: 2024-01-02\ncustom: keep\n---\n\n<Row>\n  <Photo itemKey="old.jpg" />\n</Row>\n`;
    const content = createPageContent(original, [
        { type: 'Row', props: {}, photos: [{ itemKey: 'new.jpg' }] },
    ], `title: "New"\npublishedAt: 2024-01-02\ncustom: keep`);

    assert.match(content, /publishedAt: 2024-01-02/);
    assert.match(content, /custom: keep/);
    assert.match(content, /<Photo itemKey="new\.jpg" \/>/);
    assert.doesNotMatch(content, /old\.jpg/);
});

test('referenced local names include page photos and cover basenames', () => {
    const names = referencedLocalNames([
        { type: 'Row', photos: [{ itemKey: 'one.jpg' }, { itemKey: 'yama/page/two.jpg' }] },
    ], `title: "Page"\ncoverKey: "yama/page/cover.jpg"`);

    assert.deepEqual([...names], ['one.jpg', 'two.jpg', 'cover.jpg']);
});

test('tag and photo-caption APIs persist metadata only through Album manifests', () => {
    const getData = readProjectFile('src/dev-api/get-data.ts');
    const saveTags = readProjectFile('src/dev-api/save-tags.ts');
    const editTag = readProjectFile('src/dev-api/edit-tag.ts');
    const editCaption = readProjectFile('src/dev-api/edit-caption.ts');
    const mountainCover = readProjectFile('src/dev-api/mountain-cover.ts');
    const routes = [getData, saveTags, editTag, editCaption, mountainCover];

    for (const source of routes) {
        assert.doesNotMatch(source, /src\/album-tags|\/src\/album-tags/);
        assert.doesNotMatch(source, /body\.(?:path|filePath|manifestPath)/);
    }
    assert.match(getData, /readAllAlbumManifestFiles/);
    assert.match(saveTags, /replaceAlbumPhotoTags/);
    assert.match(saveTags, /parseTagMapInput/);
    assert.ok(
        saveTags.indexOf('normalizedTagMap = parseTagMapInput(tagsMap)')
            < saveTags.indexOf('readAlbumManifestFile(cwd'),
        'untrusted tagsMap must be parsed before touching a manifest',
    );
    assert.match(editTag, /sourceAlbumSlug/);
    assert.match(editTag, /filename/);
    assert.match(editTag, /updatePhotoTags/);
    assert.doesNotMatch(editTag, /photoId/);
    assert.ok(
        editTag.indexOf('await updatePhotoTags') < editTag.indexOf('await writeMountainRegion'),
        'photo tags must validate and persist before creating mountain metadata',
    );
    assert.match(editCaption, /updatePhotoCaption/);
    assert.match(editCaption, /filename/);
    assert.match(editCaption, /typeof body\.caption !== ['"]string['"]/);
    assert.doesNotMatch(editCaption, /blockIndex|src\/content\/albums|Row\|PhotoCarousel/);
    assert.match(mountainCover, /readAlbumManifestFile/);
    assert.match(mountainCover, /writeMountainRegion/);
});
