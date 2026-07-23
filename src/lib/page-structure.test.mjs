import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createLayoutOnlyPageContent, referencedLocalNames } from './page-structure.ts';

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
    const siteDevTools = readProjectFile('src/components/SiteDevTools.astro');

    assert.match(mountainGrid, /\/yama\/tags\/\$\{encodeURIComponent\(mountain\.name\)\}/);
    assert.match(folderPage, /href=[{]["']\/yama\/tags["'][}]/);
    for (const source of [photo, devTool, mountainDevTool, siteDevTools]) {
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

test('referenced local names include only page photos', () => {
    const names = referencedLocalNames([
        { type: 'Row', photos: [{ itemKey: 'one.jpg' }, { itemKey: 'yama/page/two.jpg' }] },
    ]);

    assert.deepEqual([...names], ['one.jpg', 'two.jpg']);
});

test('layout-only Page Manager serialization never writes Album metadata to MDX', () => {
    const content = createLayoutOnlyPageContent([
        { type: 'Row', photos: [{ itemKey: 'new.jpg' }] },
    ]);
    assert.equal(content, '---\n---\n\n<Row>\n  <Photo itemKey="new.jpg" />\n</Row>\n');
    assert.doesNotMatch(
        content,
        /^(?:title|info|coverKey|coverZoom|coverOffset|gap|order|publishedAt):/m,
    );
});

test('Page Manager route and UI use structured manifest metadata without frontmatter writeback', () => {
    const getStructure = readProjectFile('src/dev-api/get-page-structure.ts');
    const saveManager = readProjectFile('src/dev-api/save-page-manager.ts');
    const devTool = readProjectFile('src/components/DevTool.astro');
    assert.match(getStructure, /readAlbumManifestFile/);
    assert.match(getStructure, /metadata/);
    assert.doesNotMatch(getStructure, /frontmatter\s*[,}]/);
    assert.match(saveManager, /createLayoutOnlyPageContent/);
    assert.match(saveManager, /withAlbumManifestLocks[\s\S]*commitAlbumPageSourcesWithinLock/);
    assert.doesNotMatch(saveManager, /if \(fs\.existsSync\(target\)\) continue/);
    assert.doesNotMatch(saveManager, /draft\.frontmatter|frontmatterString/);
    assert.match(devTool, /data\.metadata/);
    assert.match(devTool, /metadata:\s*\{/);
    assert.doesNotMatch(devTool, /frontmatter:\s*newFM|parseFM\(data\.frontmatter\)/);
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

test('cover and folder-order APIs persist only through Album manifests', () => {
    const saveCover = readProjectFile('src/dev-api/save-album-cover.ts');
    const saveOrder = readProjectFile('src/dev-api/save-folder-order.ts');
    const getFolder = readProjectFile('src/dev-api/get-folder-structure.ts');
    const devTool = readProjectFile('src/components/DevTool.astro');
    const folderPage = readProjectFile('src/pages/[folder]/index.astro');

    assert.match(saveCover, /updateAlbumCover/);
    assert.doesNotMatch(saveCover, /getAlbumBySlug/);
    assert.match(saveCover, /validateAlbumSlug/);
    assert.match(saveCover, /isRecord/);
    assert.match(saveOrder, /reorderFolderAlbums/);
    assert.match(saveOrder, /isRecord/);
    assert.match(getFolder, /readAllAlbumManifestFiles/);
    for (const source of [saveCover, saveOrder, getFolder]) {
        assert.doesNotMatch(source, /album-frontmatter|_order\.json|getCollection\(['"]albums['"]\)/);
        assert.doesNotMatch(source, /src\/content\/albums|\.mdx/);
    }
    assert.doesNotMatch(devTool, /const storedKey = sourceAlbum === state\.albumSlug/);
    assert.match(devTool, /settleCoverSave\(persisted, result/);
    assert.match(devTool, /settleCoverSave\(persisted, null\)/);
    assert.match(devTool, /Unable to reach cover save API/);
    assert.match(folderPage, /data-cover-key=\{resolvedCoverKey\}/);
    const picker = readProjectFile('src/dev-api/get-r2-cover-assets.ts');
    assert.match(picker, /createCoverPickerInventory/);
    assert.doesNotMatch(picker, /readdirSync|\br2Root\b/);
});

test('Mountain data uses one canonical schema and validated read boundaries', () => {
    const mountains = readProjectFile('src/lib/mountains.ts');
    const files = readProjectFile('src/lib/mountain-files.ts');
    const profile = readProjectFile('src/components/MountainProfile.astro');
    const tagPage = readProjectFile('src/pages/yama/tags/[tag].astro');

    assert.match(mountains, /parseMountainRegionSource/);
    assert.match(files, /parseMountainRegionSource/);
    assert.doesNotMatch(mountains, /mountain-editor|EditableMountain/);
    assert.doesNotMatch(files, /mountain-editor|EditableMountain/);
    assert.match(
        profile,
        /import type \{ Mountain \} from ["']\.\.\/lib\/mountain-schema/,
    );
    assert.doesNotMatch(profile, /export type Mountain(?:Location)?\b/);
    assert.doesNotMatch(tagPage, /mountainsData as Mountain\[\]/);
});

test('Mountain context writes validate against the proposed context set', () => {
    const contexts = readProjectFile('src/dev-api/mountain-contexts.ts');

    assert.match(
        contexts,
        /const proposedContextIds = new Set\(Object\.keys\(config\.contexts\)\)/,
    );
    assert.match(
        contexts,
        /createMountainRegionProposal\(\s*body\.region,\s*mountains,\s*proposedContextIds/s,
    );
    assert.match(
        contexts,
        /createAllMountainRegionProposals\(\s*mountains,\s*proposedContextIds/s,
    );
    assert.match(
        contexts,
        /getMountainContextReferences\(mountains, id\)[\s\S]*affectedMountains\.length > 0[\s\S]*}, 409\);[\s\S]*delete config\.contexts\[id\]/,
    );
});

test('Mountain context config and records share one source transaction', () => {
    const contexts = readProjectFile('src/dev-api/mountain-contexts.ts');

    assert.match(contexts, /commitTextFiles/);
    assert.match(contexts, /createMountainRegionProposal/);
    assert.match(contexts, /createAllMountainRegionProposals/);
    assert.match(
        contexts,
        /commitTextFiles\(\[\s*configProposal\(configFile, config\),[\s\S]*createMountainRegionProposal/,
    );
    assert.match(
        contexts,
        /commitTextFiles\(\[\s*configProposal\(configFile, config\),\s*\.\.\.\(await createAllMountainRegionProposals/,
    );
    assert.doesNotMatch(contexts, /Promise\.all\(\[\s*writeConfig/);
});

test('region removal validates Mountains against persisted map contexts', () => {
    const regions = readProjectFile('src/dev-api/mountain-regions.ts');

    assert.match(regions, /readMountainRegion/);
    assert.doesNotMatch(regions, /MAP_CONTEXTS/);
    assert.doesNotMatch(regions, /parseMountainRegionSource/);
});

test('Layout delegates footer and development tool rendering boundaries', () => {
    const layout = readProjectFile('src/layouts/Layout.astro');
    const siteFooter = readProjectFile('src/components/SiteFooter.astro');

    assert.match(
        layout,
        /import SiteFooter from ["']\.\.\/components\/SiteFooter\.astro["']/,
    );
    assert.match(
        layout,
        /import SiteDevTools from ["']\.\.\/components\/SiteDevTools\.astro["']/,
    );
    assert.match(layout, /<SiteFooter\s*\/>/);
    assert.match(layout, /<SiteDevTools\s*\/>/);
    assert.doesNotMatch(layout, /DevTool\.astro|MountainDevTool\.astro/);
    assert.doesNotMatch(layout, /\bfolderFooter\b|getFolderFooter/);
    assert.match(
        layout,
        /<head>[\s\S]*<link rel="alternate" type="application\/rss\+xml" title="RIVERBED RSS" href="\/rss\.xml" \/>[\s\S]*<\/head>/,
    );
    assert.match(
        siteFooter,
        /currentPath === ["']\/["'][\s\S]*<footer class="pb-8">[\s\S]*href="\/rss\.xml"/,
    );
    assert.doesNotMatch(siteFooter, /rel="alternate"/);
});

test('Layout delegates navigation rendering and lifecycle ownership', () => {
    const layout = readProjectFile('src/layouts/Layout.astro');
    const navigationPath = new URL('../components/SiteNavigation.astro', import.meta.url);
    const siteNavigation = existsSync(navigationPath)
        ? readFileSync(navigationPath, 'utf8')
        : '';

    assert.match(
        layout,
        /import SiteNavigation from ["']\.\.\/components\/SiteNavigation\.astro["']/,
    );
    assert.match(layout, /<SiteNavigation\s*\/>[\s\S]*<main/);

    for (const ownedNavigationDetail of [
        /getAlbumSummaries/,
        /FOLDER_METADATA/,
        /menu-toggle/,
        /mobile-menu/,
        /initNavbar/,
    ]) {
        assert.doesNotMatch(layout, ownedNavigationDetail);
    }

    assert.match(siteNavigation, /getAlbumSummaries/);
    assert.match(siteNavigation, /FOLDER_METADATA/);
    assert.match(siteNavigation, /\.sort\(\(a, b\) => a\.order - b\.order\)/);
    assert.match(siteNavigation, /data-site-navigation/);
    assert.match(siteNavigation, /data-site-menu-toggle/);
    assert.match(siteNavigation, /data-site-mobile-menu/);
    assert.match(siteNavigation, /installPageLifecycle/);
    assert.match(siteNavigation, /new AbortController\(\)/);
    assert.match(
        siteNavigation,
        /<button[\s\S]*type="button"[\s\S]*aria-controls="mobile-menu"[\s\S]*aria-expanded="false"[\s\S]*>/,
    );
    assert.match(
        siteNavigation,
        /let menuOpen = !mobileMenu\.classList\.contains\("hidden"\)/,
    );
    assert.equal(
        (siteNavigation.match(/const setMenuOpen = \(open: boolean\)/g) ?? []).length,
        1,
    );
    assert.match(
        siteNavigation,
        /menuToggle\.setAttribute\("aria-expanded", String\(open\)\)/,
    );
    assert.equal(
        (siteNavigation.match(/aria-hidden="true"/g) ?? []).length,
        2,
    );
    assert.doesNotMatch(layout, /\.condensed-kanji\s*\{|\.mask-linear-right\s*\{|\.mask-none\s*\{/);
    assert.match(siteNavigation, /\.condensed-kanji\s*\{/);
    assert.match(siteNavigation, /\.mask-linear-right\s*\{/);
    assert.doesNotMatch(siteNavigation, /astro:after-swap/);
    assert.doesNotMatch(siteNavigation, /cloneNode|replaceChild/);
});

test('Layout delegates explicit content keyboard navigation targets and lifecycle ownership', () => {
    const layout = readProjectFile('src/layouts/Layout.astro');
    const row = readProjectFile('src/components/Row.astro');
    const homePage = readProjectFile('src/pages/index.astro');
    const folderPage = readProjectFile('src/pages/[folder]/index.astro');
    const navigationPath = new URL(
        '../components/ContentKeyboardNavigation.astro',
        import.meta.url,
    );
    const contentKeyboardNavigation = existsSync(navigationPath)
        ? readFileSync(navigationPath, 'utf8')
        : '';

    assert.match(
        layout,
        /import ContentKeyboardNavigation from ["']\.\.\/components\/ContentKeyboardNavigation\.astro["']/,
    );
    assert.match(layout, /<\/main>[\s\S]*<ContentKeyboardNavigation\s*\/>/);
    assert.doesNotMatch(layout, /ArrowRight|ArrowLeft/);
    assert.doesNotMatch(layout, /\.photo-row,\s*\.album-card|addEventListener\(["']keydown/);

    assert.match(contentKeyboardNavigation.trim(), /^<script>[\s\S]*<\/script>$/);
    assert.match(contentKeyboardNavigation, /installPageLifecycle/);
    assert.match(contentKeyboardNavigation, /new AbortController\(\)/);
    assert.match(contentKeyboardNavigation, /\[data-keyboard-navigation-target\]/);
    assert.match(
        contentKeyboardNavigation,
        /dialog, input, textarea, select, \[role='textbox'\]/,
    );
    assert.match(contentKeyboardNavigation, /\.isContentEditable/);
    assert.doesNotMatch(contentKeyboardNavigation, /astro:after-swap/);
    assert.match(contentKeyboardNavigation, /addEventListener\(["']keydown["'][\s\S]*signal: controller\.signal/);
    assert.match(contentKeyboardNavigation, /controller\.abort\(\)/);
    assert.doesNotMatch(
        contentKeyboardNavigation,
        /querySelectorAll[^;]*(?:\.album-card|\.folder-card|\.photo-row)/,
    );

    assert.match(
        row,
        /<div class="photo-row" data-photo-row data-keyboard-navigation-target>/,
    );
    assert.match(
        homePage,
        /class="album-card latest-post-card group"[\s\S]*data-catalog-card[\s\S]*data-keyboard-navigation-target/,
    );
    assert.match(
        homePage,
        /class="album-card folder-card group"[\s\S]*data-catalog-card[\s\S]*data-keyboard-navigation-target/,
    );
    assert.match(
        folderPage,
        /class="album-card group"[\s\S]*data-catalog-card[\s\S]*data-keyboard-navigation-target/,
    );
    assert.equal(
        (homePage.match(/data-keyboard-navigation-target/g) ?? []).length,
        (homePage.match(/data-catalog-card/g) ?? []).length,
    );
    assert.equal(
        (folderPage.match(/data-keyboard-navigation-target/g) ?? []).length,
        (folderPage.match(/data-catalog-card/g) ?? []).length,
    );
});

test('media behavior uses page-scoped lifecycle owners with deterministic cleanup', () => {
    const layout = readProjectFile('src/layouts/Layout.astro');
    const lightboxPath = new URL('../components/PhotoLightbox.astro', import.meta.url);
    const photoLightbox = existsSync(lightboxPath)
        ? readFileSync(lightboxPath, 'utf8')
        : '';
    const photo = readProjectFile('src/components/Photo.astro');
    const row = readProjectFile('src/components/Row.astro');
    const carousel = readProjectFile('src/components/PhotoCarousel.astro');
    const mountainProfile = readProjectFile('src/components/MountainProfile.astro');

    assert.match(
        layout,
        /import PhotoLightbox from ["']\.\.\/components\/PhotoLightbox\.astro["']/,
    );
    assert.match(layout, /<PhotoLightbox\s*\/>/);
    assert.doesNotMatch(
        layout,
        /PhotoSwipeLightbox|pswp-link|initDimensions|initPhotoSwipe|<script>/,
    );

    assert.match(photoLightbox.trim(), /^<script>[\s\S]*<\/script>$/);
    assert.match(photoLightbox, /PhotoSwipeLightbox/);
    assert.match(photoLightbox, /installPageLifecycle/);
    assert.match(photoLightbox, /\[data-photo-lightbox-link\]/);
    assert.match(photoLightbox, /if \(!links\.length\) return/);
    assert.match(photoLightbox, /new AbortController\(\)/);
    assert.match(photoLightbox, /lightbox\.destroy\(\)/);

    assert.match(
        photo,
        /<a[\s\S]*class="pswp-link block"[\s\S]*data-photo-lightbox-link/,
    );
    assert.match(photo, /installPageLifecycle/);
    assert.match(photo, /new AbortController\(\)/);
    assert.match(photo, /signal: controller\.signal/);
    assert.doesNotMatch(photo, /astro:after-swap|initPhotoFallbacks\(\);/);

    assert.match(
        row,
        /<div class="photo-row" data-photo-row data-keyboard-navigation-target>/,
    );
    assert.match(row, /installPageLifecycle/);
    assert.match(row, /new AbortController\(\)/);
    assert.match(row, /\[data-photo-row\]/);
    assert.match(row, /signal: controller\.signal/);
    assert.doesNotMatch(row, /astro:after-swap|adjustRowHeights\(\);/);

    assert.match(carousel, /installPageLifecycle/);
    assert.match(carousel, /new AbortController\(\)/);
    assert.match(carousel, /observer\.disconnect\(\)/);
    assert.match(carousel, /clearTimeout/);
    assert.doesNotMatch(carousel, /astro:(?:before|after)-swap|initCarousels\(\);/);

    assert.match(mountainProfile, /installPageLifecycle/);
    assert.match(mountainProfile, /resizeObserver\.disconnect\(\)/);
    assert.match(mountainProfile, /panelObserver\.disconnect\(\)/);
    assert.match(mountainProfile, /cancelAnimationFrame/);
    assert.doesNotMatch(
        mountainProfile,
        /astro:after-swap|initMountainProfileSizing\(\);/,
    );
});

test('catalog routes share lifecycle-scoped card interactions', () => {
    const homePage = readProjectFile('src/pages/index.astro');
    const folderPage = readProjectFile('src/pages/[folder]/index.astro');
    const interactionsPath = new URL(
        '../components/CatalogCardInteractions.astro',
        import.meta.url,
    );
    const interactions = existsSync(interactionsPath)
        ? readFileSync(interactionsPath, 'utf8')
        : '';

    assert.match(
        homePage,
        /import CatalogCardInteractions from ["']\.\.\/components\/CatalogCardInteractions\.astro["']/,
    );
    assert.match(
        folderPage,
        /import CatalogCardInteractions from ["']\.\.\/\.\.\/components\/CatalogCardInteractions\.astro["']/,
    );

    for (const page of [homePage, folderPage]) {
        assert.equal(
            (page.match(/<CatalogCardInteractions\s*\/>/g) ?? []).length,
            1,
        );
        assert.match(page, /data-catalog-grid/);
        assert.match(page, /data-catalog-card/);
        assert.doesNotMatch(page, /astro:after-swap|initFolderCards|initAlbumCards/);
    }

    assert.match(
        homePage,
        /<div class="pt-6 pb-8" data-catalog-grid>[\s\S]*class="album-card latest-post-card group"[\s\S]*data-catalog-card[\s\S]*<nav[\s\S]*class="folders-grid"[\s\S]*class="album-card folder-card group"[\s\S]*data-catalog-card/,
    );
    assert.match(
        folderPage,
        /<div class="albums-grid" data-catalog-grid[\s\S]*class="album-card group"[\s\S]*data-catalog-card/,
    );
    assert.match(interactions.trim(), /^<script>[\s\S]*<\/script>$/);
    assert.match(interactions, /installPageLifecycle/);
    assert.match(interactions, /new AbortController\(\)/);
    assert.match(interactions, /root\.querySelectorAll[^;]*data-catalog-card/);
    assert.match(interactions, /const INTERVAL_MS = 5000/);
    assert.match(interactions, /window\.setInterval/);
    assert.match(interactions, /clearInterval/);
    assert.match(interactions, /controller\.abort\(\)/);
    assert.match(interactions, /classList\.remove\("show-info"\)/);
    assert.match(
        interactions,
        /\(max-width: 768px\) and \(hover: none\)[\s\S]*classList\.contains\("show-info"\)[\s\S]*event\.preventDefault\(\)/,
    );
    assert.match(
        interactions,
        /card\.contains\(target\)[\s\S]*if \(!isInsideCurrentCard\)/,
    );
    assert.doesNotMatch(
        interactions,
        /document\.querySelectorAll[^;]*\.album-card/,
    );
});
