import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    applyDefaultCaptionBoundaryMargin,
    createLayoutOnlyPageContent,
    movePageBlock,
    movePagePhotos,
    rowCells,
    serializePageBody,
    referencedLocalNames,
} from './page-structure.ts';

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

test('caption spacing initializes the adjacent block bottom margin without replacing custom spacing', () => {
    const topBlocks = [
        { type: 'Row', props: {}, photos: [] },
        { type: 'Row', props: { caption: 'Top', captionPosition: 'center top' }, photos: [] },
    ];
    assert.equal(applyDefaultCaptionBoundaryMargin(topBlocks, 1), true);
    assert.equal(topBlocks[0].props.blockMargin, '1.5rem');

    const textBeforeTopCaption = [
        { type: 'Text', props: {}, text: 'Section' },
        { type: 'Row', props: { caption: 'Top', captionPosition: 'center top' }, photos: [] },
    ];
    assert.equal(applyDefaultCaptionBoundaryMargin(textBeforeTopCaption, 1), true);
    assert.equal(textBeforeTopCaption[0].props.blockMargin, '1.5rem');

    const bottomBlocks = [
        { type: 'Row', props: {}, photos: [] },
        { type: 'Row', props: { caption: 'Bottom', blockMargin: '3rem' }, photos: [] },
        { type: 'Text', props: {}, text: 'Next' },
    ];
    assert.equal(applyDefaultCaptionBoundaryMargin(bottomBlocks, 1), false);
    assert.equal(bottomBlocks[1].props.blockMargin, '3rem');

    bottomBlocks[1].props.blockMargin = '0.5rem';
    assert.equal(applyDefaultCaptionBoundaryMargin(bottomBlocks, 1), false);
    assert.equal(bottomBlocks[1].props.blockMargin, '0.5rem');
    delete bottomBlocks[1].props.blockMargin;
    assert.equal(applyDefaultCaptionBoundaryMargin(bottomBlocks, 1), true);
    assert.equal(bottomBlocks[1].props.blockMargin, '1.5rem');
    assert.equal(applyDefaultCaptionBoundaryMargin(bottomBlocks, 2), false);
});

test('Page Manager serialization retires captionMargin', () => {
    const content = createLayoutOnlyPageContent([
        {
            type: 'Row',
            props: { caption: 'Caption', captionMargin: '3rem', blockMargin: '1.5rem' },
            photos: [{ itemKey: 'one.jpg' }],
        },
    ]);
    assert.doesNotMatch(content, /captionMargin/);
    assert.match(content, /blockMargin="1\.5rem"/);
});

test('caption serialization and pending preview preserve manual line breaks', () => {
    const content = createLayoutOnlyPageContent([
        {
            type: 'Row',
            props: { caption: 'First line\nSecond line' },
            photos: [{ itemKey: 'one.jpg' }],
        },
    ]);
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(content, /caption="First line\nSecond line"/);
    assert.match(devTool, /\.dev-caption-live-preview\s*\{\s*white-space: pre-line;/);
    assert.match(devTool, /preview\.classList\.add\('dev-caption-live-preview'\);\s*preview\.textContent = caption/);
    assert.match(devTool, /stageInlineCaption\(textInput\.value\.trim\(\)\)/);
});

test('Text serialization uses one bottom block margin and retires legacy Text margins', () => {
    const content = createLayoutOnlyPageContent([
        { type: 'Text', props: { align: 'left', size: 'title', mt: '2rem', mb: '1.5rem' }, text: 'Section' },
        { type: 'Row', props: { blockMargin: '0.5rem' }, photos: [{ itemKey: 'one.jpg' }] },
    ]);

    assert.match(content, /<Text\s+align="left"\s+size="title"\s+blockMargin="1\.5rem">/);
    assert.doesNotMatch(content, /\smt=|\smb=/);
    assert.doesNotMatch(content, /blockMargin="0\.5rem"/);
});

test('PhotoPanorama serialization preserves its configured initial view and slide', () => {
    const content = createLayoutOnlyPageContent([{
        type: 'PhotoPanorama',
        props: { initialView: 'panorama', initialSlide: 2 },
        photos: [
            { itemKey: 'one.jpg' },
            { itemKey: 'two.jpg' },
            { itemKey: 'three.jpg' },
        ],
    }]);

    assert.match(content, /<PhotoPanorama\s+initialSlide=\{2\}\s+initialView="panorama">/);
    assert.match(content, /<Photo itemKey="three\.jpg" \/>/);
    assert.match(content, /<\/PhotoPanorama>/);
    assert.doesNotMatch(content, /<PhotoCarousel|enablePanorama/);
});

test('PhotoCarousel serialization drops panorama-only props', () => {
    const content = createLayoutOnlyPageContent([{
        type: 'PhotoCarousel',
        props: { initialView: 'panorama', panoramaSlices: 3, initialSlide: 1 },
        photos: [{ itemKey: 'one.jpg' }, { itemKey: 'two.jpg' }],
    }]);

    assert.match(content, /<PhotoCarousel\s+initialSlide=\{1\}>/);
    assert.doesNotMatch(content, /initialView|panoramaSlices|enablePanorama/);
});

test('single-photo panorama serializes a bounded display-only slice count', () => {
    const single = createLayoutOnlyPageContent([{
        type: 'PhotoPanorama',
        props: { panoramaSlices: 3 },
        photos: [{ itemKey: 'one.jpg' }],
    }]);
    const multiple = createLayoutOnlyPageContent([{
        type: 'PhotoPanorama',
        props: { panoramaSlices: 3 },
        photos: [{ itemKey: 'one.jpg' }, { itemKey: 'two.jpg' }],
    }]);

    assert.match(single, /<PhotoPanorama\s+panoramaSlices=\{3\}>/);
    assert.doesNotMatch(multiple, /panoramaSlices/);
});

test('PhotoPanorama is a standalone block with full-width carousel and joined proportional views', () => {
    const carousel = readProjectFile('src/components/PhotoCarousel.astro');
    const panorama = readProjectFile('src/components/PhotoPanorama.astro');
    const albumPage = readProjectFile('src/pages/[folder]/[album].astro');
    const getStructure = readProjectFile('src/dev-api/get-page-structure.ts');
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.doesNotMatch(carousel, /enablePanorama|PhotoPanorama|panoramaSlices/);
    assert.match(albumPage, /import PhotoPanorama from "\.\.\/\.\.\/components\/PhotoPanorama\.astro"/);
    assert.match(albumPage, /components=\{\{ Row, Column, Photo: AlbumPhoto, Text, PhotoCarousel, PhotoPanorama \}\}/);
    assert.match(panorama, /initialView\?: PanoramaView/);
    assert.match(panorama, /data-initial-view=\{view\}/);
    assert.match(panorama, /data-panorama-slices=\{displaySlices\}/);
    assert.match(panorama, /data-view=\{view\}/);
    assert.match(panorama, /data-view="carousel"[^}]*\.photo-panorama-track > :global\(\*\)[\s\S]*?flex:\s*0 0 100%/);
    assert.match(panorama, /data-view="panorama"[^}]*\.photo-panorama-track > :global\(\*\)[\s\S]*?flex:\s*var\(--panorama-grow, 100\) 1 0%/);
    assert.match(panorama, /gap:\s*0/);
    assert.match(panorama, /photo-panorama-arrow--previous/);
    assert.match(panorama, /photo-panorama-arrow--next/);
    assert.match(panorama, /photo-panorama-stage:hover \.photo-panorama-arrow:not\(:disabled\)/);
    assert.match(panorama, /@media \(max-width: 767px\)[\s\S]*?\.photo-panorama-arrow\s*\{\s*display:\s*none/);
    assert.match(panorama, /@media \(max-width: 767px\)[\s\S]*?\[data-view="carousel"\] \.photo-panorama-track\s*\{\s*scroll-snap-type: none/);
    assert.match(panorama, /if \(track\.clientWidth === observedWidth\) return/);
    assert.match(panorama, /@media \(max-width: 767px\)[\s\S]*?\.photo-panorama-dots\s*\{\s*display: none/);
    assert.equal((panorama.match(/viewBox="0 0 16 16"/g) || []).length, 2);
    assert.match(panorama, /photo-panorama-view-icon--carousel[\s\S]*?<rect x="0\.5" y="4" width="3" height="8"[\s\S]*?<rect x="6\.5" y="4" width="3" height="8"[\s\S]*?<rect x="12\.5" y="4" width="3" height="8"/);
    assert.match(panorama, /photo-panorama-view-icon--panorama[\s\S]*?<rect x="0\.5" y="4" width="15" height="8"/);
    assert.doesNotMatch(panorama, /tags-overlay[^}]*display:\s*none/);
    assert.match(panorama, /@media \(min-width: 768px\)\s*\{[\s\S]*?\.photo-panorama-section \.photo-panorama-track :global\(\.photo-img\)\s*\{\s*border-radius: 0/);
    assert.match(panorama, /data-view="panorama"[^}]*\.photo-panorama-track:hover :global\(\.tags-overlay\)/);
    assert.match(panorama, /const animations = slides\.map[\s\S]*?translate\([^)]*before\.top - after\.top[\s\S]*?scale\([\s\S]*?transformOrigin: "top left"[\s\S]*?slide\.animate\(keyframes/);
    assert.doesNotMatch(panorama, /scaleX\(/);
    assert.match(panorama, /const keepBottomEdge = isPanorama[\s\S]*?beforeStageHeight - stage\.getBoundingClientRect\(\)\.height[\s\S]*?beforeScrollY - shrunk[\s\S]*?window\.scrollTo\(\{ top: target, behavior: "instant" \}\)/);
    assert.doesNotMatch(panorama, /window\.scrollBy/);
    assert.match(panorama, /html:has\(\.photo-panorama-section\[data-view-transitioning\]\)\)\s*\{\s*overflow-anchor: none/);
    assert.match(panorama, /useMobileCarouselReveal[\s\S]*?nextView === "carousel"[\s\S]*?activeIndex > 0[\s\S]*?max-width: 767px/);
    assert.match(panorama, /const keyframes = useMobileCarouselReveal[\s\S]*?opacity: 0[\s\S]*?opacity: 1/);
    assert.match(panorama, /duration: 650[\s\S]*?cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
    assert.match(panorama, /await Promise\.allSettled\(animations\.map\(\(animation\) => animation\.finished\)\)/);
    assert.doesNotMatch(panorama, /scrollIntoView/);
    assert.match(panorama, /sourceSlides\.length === 1[\s\S]*?originalDisplayUrl = sourceLightbox\?\.dataset\.pswpSrc[\s\S]*?sourceImage\.removeAttribute\("srcset"\)[\s\S]*?sourceImage\.removeAttribute\("sizes"\)[\s\S]*?sourceImage\.src = originalDisplayUrl/);
    assert.match(panorama, /sourceSlides\.length === 1 && requestedSlices > 1/);
    assert.match(panorama, /sourceSlide\.cloneNode\(true\)/);
    assert.match(panorama, /slides = sliceSlides/);
    assert.match(panorama, /--panorama-slice-offset/);
    assert.match(panorama, /--panorama-slice-clip-start/);
    assert.match(panorama, /--panorama-slice-mobile-clip-start/);
    assert.match(panorama, /\.photo-panorama-slice \.photo-wrapper\)\s*\{\s*overflow: visible/);
    assert.match(panorama, /clip-path: inset/);
    assert.match(panorama, /data-view="panorama"[^}]*data-single-photo-sliced[\s\S]*?--panorama-slice-mobile-clip-end/);
    assert.match(panorama, /const owner = Math\.min[\s\S]*?if \(owner !== index\)[\s\S]*?marker\.style\.left/);
    assert.match(panorama, /sliceWrapper\.dataset\.panoramaSourceItemKey = sourceItemKey/);
    assert.match(panorama, /data-single-photo-sliced[^}]*photo-panorama-single-source\)\s*\{\s*display: none/);
    assert.match(panorama, /\.photo-panorama-controls\s*\{\s*position: relative;\s*z-index: 3/);
    assert.match(panorama, /data-view="panorama"\] \.photo-panorama-dots\s*\{\s*display: none/);
    assert.match(getStructure, /Row\|PhotoCarousel\|PhotoPanorama\|Text/);
    assert.match(getStructure, /type === 'PhotoCarousel' && \/\\benablePanorama[\s\S]*?type = 'PhotoPanorama'/);
    assert.match(getStructure, /panoramaSlices=\\\{\(\\d\+\)\\\}/);
    assert.match(getStructure, /initialView="\(carousel\|panorama\)"/);
    assert.match(devTool, /label: 'Panorama', value: 'PhotoPanorama'/);
    assert.doesNotMatch(devTool, /enablePanorama|targetPanorama|sourcePanorama/);
    assert.doesNotMatch(devTool, /photo-panorama-initial-view/);
    assert.match(devTool, /const stageDirectInitialView = async/);
    assert.match(devTool, /initialView: 'carousel' \| 'panorama'/);
    assert.match(devTool, /initialViewOption\.textContent = 'Set Initial View'/);
    assert.match(devTool, /showInitialViewOptions/);
    assert.match(devTool, /class="photo-panorama-slices" type="number" min="1" max="24"/);
    assert.match(devTool, /wrapper\.dataset\.itemKey \|\| wrapper\.dataset\.panoramaSourceItemKey/);
    assert.match(devTool, /data-panorama-source-item-key/);
    assert.match(devTool, /type MediaBlockType = 'Row' \| 'PhotoCarousel' \| 'PhotoPanorama'/);
    assert.match(devTool, /sourceType: MediaBlockType;\s*targetType: MediaBlockType;/);
    assert.match(devTool, /if \(change\.targetType !== 'PhotoPanorama'\) \{\s*delete target\.props\.initialView;\s*delete target\.props\.panoramaSlices/);
    assert.match(devTool, /slicesOption\.textContent = 'Set Slices'/);
    assert.match(devTool, /const stageDirectPanoramaSlices = async/);
});

test('caption spacing is applied when direct block changes are saved', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /structure\.blocks\[targetIndex\]\.props = props;\s*if \(change\.caption\) applyDefaultCaptionBoundaryMargin\(structure\.blocks, targetIndex\)/,
    );
});

test('new pending captions immediately stage their 1.5rem boundary margin', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /automaticSpacingKey\?: string/);
    assert.match(
        devTool,
        /const reconcileAutomaticBlockMargins = \(\) => \{[\s\S]*?collectRequiredBoundaries[\s\S]*?captionPosition\.includes\('top'\)[\s\S]*?action: isRequired \? 'set' : 'remove'/,
    );
    assert.match(
        devTool,
        /if \(pendingMarginEntry && !pendingMarginEntry\[1\]\.automaticSpacingKey\)[\s\S]*?stageBlockMargin\('1\.5rem', detail\.spacingKey, true\)/,
    );
    assert.match(
        devTool,
        /updateCaptionPreview\(caption, captionPosition, matchesFile\);\s*reconcileAutomaticBlockMargins\(\)/,
    );
});

test('deleting a persisted caption restores its default boundary margin as pending', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /const sourceBoundaries = collectRequiredBoundaries\(false\);\s*const pendingBoundaries = collectRequiredBoundaries\(true\)/,
    );
    assert.match(
        devTool,
        /if \(detail\.action === 'remove'\) \{[\s\S]*?remValueFromInput\(originalBlockMargin\) === '1\.5rem'[\s\S]*?stageBlockMargin\('', detail\.spacingKey, true\)/,
    );
    assert.match(
        devTool,
        /if \(change\.blockMargin && change\.blockMargin !== '0\.5rem'\) props\.blockMargin = change\.blockMargin;\s*else delete props\.blockMargin/,
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

test('album metadata editing is an Edit blocks control below the album info', () => {
    const albumPage = readProjectFile('src/pages/[folder]/[album].astro');
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(albumPage, /data-album-heading[\s\S]*?data-album-title/);
    assert.match(devTool, /function initAlbumMetadataEditor\(\)/);
    assert.match(devTool, /data-dev-album-metadata-edit/);
    assert.match(devTool, /dev-album-metadata-edit-button/);
    assert.match(devTool, /if \(!activeBlockEditMode\) return;/);
    assert.match(devTool, /\(info \|\| title\)\.insertAdjacentElement\('afterend', editor\);/);
    assert.match(devTool, /closeAlbumMetadataEditor\(\);\s*document\.querySelector<HTMLElement>\('\.dev-album-metadata-editor'\)\?\.remove\(\);/);
    assert.match(devTool, /\} else \{\s*initAlbumMetadataEditor\(\);/);
    assert.match(devTool, /Title<input class="dev-album-metadata-title"/);
    assert.match(devTool, /Info<input class="dev-album-metadata-info"/);
    assert.match(devTool, /Default block margin<input class="dev-album-metadata-margin"/);
    assert.match(devTool, /const stageDirectAlbumMetadata = async/);
    assert.match(devTool, /gap: remValueFromInput\(defaultMarginValue\) \|\| undefined/);
    assert.doesNotMatch(devTool, /dev-pm-fm-section|dev-pm-title|dev-pm-info|dev-pm-gap/);
});

test('Page Manager photo thumbnails fall back from missing local assets to R2', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /import \{ R2_DOMAIN \} from ["']\.\.\/lib\/constants["']/);
    assert.match(
        devTool,
        /src="\/r2\/\$\{encodedKey\}" data-pm-fallback-url="\$\{R2_DOMAIN\}\/\$\{encodedKey\}"/,
    );
    assert.match(
        devTool,
        /querySelectorAll<HTMLImageElement>\('img\[data-pm-fallback-url\]'\)[\s\S]*?delete image\.dataset\.pmFallbackUrl;[\s\S]*?image\.src = fallbackUrl;/,
    );
    assert.match(devTool, /addEventListener\('error', useFallback, \{ once: true \}\)/);
});

test('Add Page and Add Photos can sort candidates by filename or time in either direction', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /data-import-sort-name/);
    assert.match(devTool, /data-import-sort-time/);
    assert.match(devTool, /sortNameBtn\.addEventListener\('click', \(\) => selectSortKey\('name'\)\)/);
    assert.match(devTool, /sortTimeBtn\.addEventListener\('click', \(\) => selectSortKey\('time'\)\)/);
    assert.match(devTool, /if \(sortKey === nextKey\) sortDirection = sortDirection === 'asc' \? 'desc' : 'asc'/);
    assert.match(devTool, /sortDirection = 'asc'/);
    assert.match(devTool, /files = sortPhotoImportFiles\(files, sortKey, sortDirection\)/);
    assert.match(devTool, /selectedFilesBeforeSort[\s\S]*?selectedFilesBeforeSort\.has\(file\)/);
    assert.match(devTool, /files = sortPhotoImportFiles\(added, sortKey, sortDirection\)/);
});

test('Add Page and Add Photos support modifier-based multi-selection', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /Click: select · Ctrl\/⌘: toggle · Shift: range/);
    assert.match(devTool, /aria-multiselectable="true"/);
    assert.match(devTool, /selectPhotoImportIndex\(\{/);
    assert.match(devTool, /additive: event\.ctrlKey \|\| event\.metaKey \|\| \(fromCheckbox && !event\.shiftKey\)/);
    assert.match(devTool, /range: event\.shiftKey/);
    assert.match(devTool, /checkbox\.addEventListener\('click',[\s\S]*?applyPointerSelection\(event, index, true\)/);
    assert.match(devTool, /selectionAnchorFile[\s\S]*?files\.indexOf\(selectionAnchorFile\)/);
});

test('Album R2 trash actions preserve the dry-run ETag', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /item\.action === 'trash'\)\.map\(\(item: any\) => \(\{\s*key: item\.key,\s*action: 'trash',\s*etag: item\.etag,/,
    );
});

test('direct block margin control stages changes for the shared save action', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /dev-inline-margin-control[\s\S]*?dev-inline-margin-input/,
    );
    assert.match(devTool, /marginInput\.addEventListener\('keydown',[\s\S]*?event\.key === 'Enter'[\s\S]*?stageBlockMargin\(\)/);
    assert.match(devTool, /event\.key === 'Escape'[\s\S]*?closeInlineMarginEditor\(\)/);
    assert.doesNotMatch(devTool, /dev-inline-margin-(?:save|cancel)/);
    assert.match(devTool, /pendingBlockMarginChanges\.set\(pendingMarginKey/);
    assert.match(
        devTool,
        /const fileEffectiveMargin = remValueFromInput\(remValueForInput\(originalBlockMargin \|\| visibleMargin\)\)/,
    );
    assert.match(devTool, /const expectedEffectiveMargin = originalBlockMargin[\s\S]*?defaultMarginForType\(displayedType\)/);
    assert.match(devTool, /const matchesFile = blockMargin === expectedEffectiveMargin/);
    assert.match(devTool, /if \(matchesFile\) \{\s*if \(pendingMarginEntry\) pendingBlockMarginChanges\.delete\(pendingMarginEntry\[0\]\)/);
    assert.match(devTool, /updateMarginPreview\(matchesFile \? originalBlockMargin : blockMargin\)/);
    assert.match(devTool, /savePendingPageChanges/);
    assert.match(devTool, /dev-inline-margin-control\.has-data:hover[\s\S]*?background: rgba\(59, 130, 246, 0\.8\)/);
    assert.match(devTool, /activeMarginControl && activeMarginControl !== marginControl[\s\S]*?classList\.remove\('is-open'\)/);
    assert.doesNotMatch(devTool, /block-margin-block|margin-block-reset/);
});

test('Page Manager delegates all Text settings to the direct Text toolbar', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');
    const text = readProjectFile('src/components/Text.astro');
    const getStructure = readProjectFile('src/dev-api/get-page-structure.ts');

    assert.doesNotMatch(devTool, /dev-pm-margin-control|text-block-mt|text-block-mb|text-block-content|text-block-align|text-block-size/);
    assert.match(devTool, /dev-btn-text[\s\S]*?title="Edit Text"[\s\S]*?\$\{ICONS\.quote\}/);
    assert.match(devTool, /dev-inline-text-input[\s\S]*?dev-inline-text-align[\s\S]*?dev-inline-text-type/);
    assert.match(devTool, /pendingTextChanges\.set\(pendingTextKey/);
    assert.match(devTool, /textButton\?\.classList\.toggle\('has-pending', !matchesFile\)/);
    assert.match(text, /data-dev-block=\{isDev \? "text" : undefined\}/);
    assert.match(text, /margin-bottom: \$\{finalBlockMargin\}/);
    assert.doesNotMatch(text, /margin-top:/);
    assert.match(getStructure, /blockMarginMatch[\s\S]*?props\.blockMargin/);
});

test('Page Manager delegates caption editing to the direct block toolbar', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.doesNotMatch(devTool, /block-caption-toggle|dev-pm-caption-editor|tree-caption-preview/);
    assert.match(devTool, /dev-inline-caption-editor/);
});

test('development block controls reveal on hover and place edit controls beside the add control', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /\.dev-block-toolbar\s*\{[\s\S]*?bottom:\s*0;[\s\S]*?left:\s*-2\.75rem;[\s\S]*?flex-direction:\s*column;/,
    );
    assert.match(
        devTool,
        /\.dev-block-edit-mode \.dev-block-overlay:hover > \.dev-block-toolbar,[\s\S]*?\.dev-block-toolbar\.is-open/,
    );
    assert.match(devTool, /\.dev-block-edit-mode \.dev-block-overlay:hover > \.dev-page-inline-add-zone,[\s\S]*?opacity: 1;/);
    assert.match(devTool, /\.dev-block-overlay::before\s*\{[\s\S]*?left:\s*-3\.25rem;[\s\S]*?width:\s*3\.25rem;/);
    assert.match(
        devTool,
        /\.dev-block-edit-mode \.dev-block-overlay\[data-dev-block="text"\]\s*\{[\s\S]*?z-index:\s*1;/,
    );
    assert.match(devTool, /dev-inline-margin-control, \.dev-inline-block-type-control, \.dev-btn-caption, \.dev-btn-text/);
    assert.match(devTool, /dev-btn-caption, \.dev-block-toolbar \.dev-btn-text/);
    assert.match(devTool, /dev-btn-text[\s\S]*?title="Edit Text"[\s\S]*?\$\{ICONS\.quote\}/);
    assert.match(devTool, /const setGlobalTagMode = \(enabled: boolean\)/);
    assert.match(devTool, /document\.querySelectorAll<HTMLElement>\('\[data-dev-block\]'\)[\s\S]*?dev-tag-mode/);
    assert.match(devTool, /dev-block-overlay\.dev-tag-mode \.tags-overlay/);
    assert.match(devTool, /\.dev-block-overlay\.dev-tag-mode \.photo-wrapper[\s\S]*?cursor: crosshair/);
    assert.doesNotMatch(devTool, /\n\s+\.photo-wrapper\s*\{\s*cursor: crosshair/);
    assert.match(devTool, /if \(!wrapper\.closest\('\.dev-tag-mode'\)\) return;/);
    assert.match(devTool, /editor\.className = 'dev-inline-caption-editor';/);
    assert.match(devTool, /blockElement\.insertBefore\(editor, captionAnchor\);/);
    assert.match(devTool, /pendingCaptionChanges\.set\(captionChangeKey/);
    assert.match(devTool, /const matchesFile = caption === fileCaption && captionPosition === fileCaptionPosition/);
    assert.match(devTool, /if \(matchesFile\) \{\s*pendingCaptionChanges\.delete\(captionChangeKey\)/);
    assert.match(devTool, /saveBtn\.innerHTML = ICONS\.pencil/);
    assert.match(devTool, /if \(hasPendingChanges\(\)\) \{\s*void savePendingChanges\(\);/);
    assert.match(devTool, /setLayoutEditMode\(true\)/);
    assert.match(devTool, /sessionStorage\.setItem\('dev-caption-save-scroll-y'/);
});

test('tag editing is a global toggle and inline page editors are mutually exclusive', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /tagButton\.id = 'dev-tag-toggle'/);
    assert.match(devTool, /actions\.append\(\s*tagButton,\s*managerButton,/);
    assert.match(devTool, /const toggleInlineTagMode = \(\) => \{[\s\S]*?setGlobalTagMode\(!activeTagMode\);/);
    assert.doesNotMatch(devTool, /const savePendingTagChangesOnly = async/);
    assert.match(devTool, /if \(\(event\.target as HTMLElement\)\.closest\('\.dev-tag-edit-btn, \.tag-link'\)\) return;/);
    assert.match(devTool, /function closeOtherPageEditors\(except\?: HTMLElement\)/);
    assert.match(devTool, /document\.querySelector\('\.dev-page-inline-add-menu'\)\?\.remove\(\)/);
    assert.match(devTool, /document\.querySelectorAll<HTMLElement>\('\.dev-inline-caption-editor'\)/);
    assert.match(devTool, /document\.querySelectorAll<HTMLElement>\('\.dev-inline-text-editor'\)/);
    assert.match(devTool, /document\.querySelectorAll<HTMLElement>\('\.dev-inline-margin-control\.is-open'\)/);
    assert.match(devTool, /document\.querySelectorAll<HTMLElement>\('\.dev-inline-block-type-control\.is-open'\)/);
    assert.match(devTool, /const openInlineCaptionEditor = \(\) => \{\s*if \(!canStartEditMode\('blocks'\)\) return;\s*closeOtherPageEditors/);
    assert.match(devTool, /const openInlineTextEditor = \(\) => \{\s*if \(!canStartEditMode\('blocks'\)\) return;\s*closeOtherPageEditors/);
    assert.match(devTool, /const openInlineMarginEditor = \(\) => \{\s*if \(!canStartEditMode\('blocks'\)\) return;\s*closeOtherPageEditors/);
});

test('album utility controls expose one Edit blocks entry point and R2 sync outside Page Manager', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.doesNotMatch(devTool, /dev-pm-r2-sync|dev-pm-expand-all|ICONS\.expandAll|ICONS\.collapseAll/);
    assert.match(devTool, /gearBtn\.id = primaryButtonId/);
    assert.match(devTool, /const primaryButtonId = isAlbumPage \? 'dev-save-btn' : 'dev-gear-btn';/);
    assert.match(devTool, /gearBtn\.innerHTML = isAlbumPage \? ICONS\.pencil : ICONS\.gear/);
    assert.match(devTool, /gearBtn\.title = 'Edit blocks'/);
    assert.match(devTool, /setLayoutEditMode\(true\)/);
    assert.match(devTool, /saveBtn\.addEventListener\('click', \(\) => \{[\s\S]*?if \(activeBlockEditMode\) \{\s*setGlobalTagMode\(false\);\s*setLayoutEditMode\(false\);/);
    assert.match(devTool, /syncBtn\.id = 'dev-album-sync-btn'/);
    assert.match(devTool, /syncBtn\.title = 'Sync with R2'/);
    assert.match(devTool, /void openAlbumSyncDialog\(albumSlug\)/);
    assert.match(
        devTool,
        /const controls = \[\s*document\.getElementById\('dev-save-btn'\),\s*document\.getElementById\('dev-album-sync-btn'\)/,
    );
});

test('media block add menus can add photos to their own block through the shared pending structure', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /const stageDirectBlockPhotos = async \(blockKey: string, fallbackIndex: number, files: File\[\]\)/);
    assert.match(devTool, /targetBlock\.photos\.push\(\.\.\.files\.map\(\(file\) => \(\{ itemKey: file\.name \}\)\)\)/);
    assert.match(devTool, /const chooseDirectBlockPhotoAddition = \(blockKey: string, fallbackIndex: number\)/);
    assert.match(devTool, /targetBlock\?\.isMedia[\s\S]*?addPhotosButton\.textContent = 'Add Photos'/);
    assert.match(devTool, /isMedia: block\.dataset\.devBlock !== 'text'/);
    assert.match(devTool, /already exists in this album; use its existing entry/);
});

test('block action menu confirms photo deletion and carousel initial-photo selection inline', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /moreButton\.className = 'dev-page-inline-more-button'/);
    assert.match(devTool, /moreButton\.innerHTML = ICONS\.dots/);
    assert.match(devTool, /const openInlineBlockActionMenu = \(/);
    assert.match(devTool, /addOption\('Delete Block', 'delete-block'\)/);
    assert.match(devTool, /addOption\('Delete Photos', 'delete-photos'\)/);
    assert.match(devTool, /addOption\('Set Initial Photo', 'set-initial-photo'\)/);
    assert.match(devTool, /targetBlock\.isPanorama/);
    assert.match(devTool, /const stagedBlockTypeChange = pendingBlockTypeChanges\.get\(block\.dataset\.devTypeChangeKey \|\| ''\)/);
    assert.match(devTool, /isCarousel: isCarouselLikeType\(displayedType\) \|\| displayedType === 'carousel'/);
    assert.match(devTool, /const stageDirectBlockDeletion = async/);
    assert.match(devTool, /const stageDirectPhotoDeletion = async/);
    assert.match(devTool, /const stageDirectInitialPhoto = async/);
    assert.match(devTool, /pendingType\?: 'PhotoCarousel' \| 'PhotoPanorama'/);
    assert.match(devTool, /if \(pendingType\) block\.type = pendingType/);
    assert.match(devTool, /block\.props\.initialSlide = initialSlide/);
    assert.match(devTool, /dev-inline-photo-selected[\s\S]*?outline: 3px solid #dc2626/);
    assert.match(devTool, /dev-block-photo-action--initial[\s\S]*?outline-color: #2563eb/);
    assert.match(devTool, /confirm\.innerHTML = kind === 'set-initial-photo' \? ICONS\.check : ICONS\.trash/);
    assert.match(devTool, /cancel\.innerHTML = ICONS\.close/);
});

test('pending captions share the component presentation used by persisted captions', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');
    const row = readProjectFile('src/components/Row.astro');
    const carousel = readProjectFile('src/components/PhotoCarousel.astro');

    assert.match(row, /:global\(\.row-wrapper > \.photo-caption\)/);
    assert.match(carousel, /:global\(\.carousel-section > \.photo-caption\)/);
    assert.match(devTool, /preview\.classList\.toggle\('dev-caption-generated-preview', isGeneratedPreview\)/);
    assert.doesNotMatch(devTool, /\.dev-caption-generated-preview\s*\{[\s\S]*?color:/);
    assert.doesNotMatch(devTool, /\.dev-page-structure-preview > \.photo-caption\s*\{[\s\S]*?color:/);
    assert.doesNotMatch(devTool, /\.dev-block-overlay > \.photo-caption\s*\{\s*color:/);
    assert.match(devTool, /let style = document\.getElementById\('dev-tool-styles'\)[\s\S]*?if \(!style\)[\s\S]*?style\.textContent = `/);
    assert.doesNotMatch(devTool, /if \(document\.getElementById\('dev-tool-styles'\)\) return/);
});

test('carousel edge slides use scrollable spacers so every active photo shares one centre', () => {
    const carousel = readProjectFile('src/components/PhotoCarousel.astro');
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(carousel, /--carousel-edge:\s*calc\(\(100% - var\(--slide-width, 100%\)\) \/ 2\)/);
    assert.match(carousel, /\.carousel-track::before,[\s\S]*?\.carousel-track::after[\s\S]*?flex:\s*0 0 var\(--carousel-edge\)/);
    assert.match(carousel, /\.carousel-track::before\s*\{[\s\S]*?margin-inline-end:\s*calc\(-1 \* var\(--gap, 0\.5rem\)\)/);
    assert.match(carousel, /\.carousel-track::after\s*\{[\s\S]*?margin-inline-start:\s*calc\(-1 \* var\(--gap, 0\.5rem\)\)/);
    assert.doesNotMatch(carousel, /padding-inline:\s*calc\(\(100% - var\(--slide-width/);

    assert.match(devTool, /\.dev-page-structure-preview \.carousel-track::before,[\s\S]*?flex:\s*0 0 calc\(\(100% - var\(--slide-width, 100%\)\) \/ 2\)/);
    assert.match(devTool, /\.dev-preview-as-carousel > \.photo-row::before,[\s\S]*?flex:\s*0 0 0%/);
    assert.match(devTool, /\.dev-preview-as-row > \.carousel-track::before,[\s\S]*?display:\s*none/);
});

test('carousel defaults to full-width slides with arrows and an adjustable peek', () => {
    const carousel = readProjectFile('src/components/PhotoCarousel.astro');
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(carousel, /gap = "0\.5rem"/);
    assert.match(carousel, /peekPercent = 0/);
    assert.match(carousel, /const showArrows = peek === 0/);
    assert.match(carousel, /\{showArrows && \([\s\S]*?carousel-arrow--previous[\s\S]*?carousel-arrow--next/);
    assert.match(carousel, /previous\.disabled = activeIndex <= 0/);
    assert.match(carousel, /next\.disabled = activeIndex >= slides\.length - 1/);
    assert.match(carousel, /--carousel-arrow-top/);
    assert.match(carousel, /height: var\(--carousel-arrow-height, 100%\)/);
    assert.doesNotMatch(carousel, /carousel-arrow:hover/);
    assert.doesNotMatch(carousel, /carousel-arrow\)\s*\{[^}]*border-radius/);
    assert.match(carousel, /@media \(max-width: 767px\)\s*\{\s*:global\(\.carousel-section > \.carousel-arrow\)\s*\{\s*display: none/);
    assert.match(carousel, /data-peek-percent=\{isDev \? peek : undefined\}/);
    assert.match(devTool, /\.dev-page-structure-preview \.carousel-track > \*[\s\S]*?flex:\s*0 0 var\(--slide-width, 100%\)/);
    assert.match(devTool, /\.dev-preview-as-carousel > \.photo-row > \*[\s\S]*?flex:\s*0 0 100% !important/);
    assert.match(devTool, /peekOption\.textContent = 'Set Peek'/);
    assert.match(devTool, /const stageDirectPeekPercent = async/);
    assert.match(devTool, /className = `carousel-arrow carousel-arrow--\$\{direction\}`/);
});

test('carousel peek percent serializes only when set on a carousel', () => {
    const photos = [{ itemKey: 'one.jpg' }, { itemKey: 'two.jpg' }];
    const peek = createLayoutOnlyPageContent([{ type: 'PhotoCarousel', props: { peekPercent: 20, initialSlide: 1 }, photos }]);
    const none = createLayoutOnlyPageContent([{ type: 'PhotoCarousel', props: { peekPercent: 0 }, photos }]);
    const clamped = createLayoutOnlyPageContent([{ type: 'PhotoCarousel', props: { peekPercent: 150 }, photos }]);
    const panorama = createLayoutOnlyPageContent([{ type: 'PhotoPanorama', props: { peekPercent: 20 }, photos }]);
    const getStructure = readProjectFile('src/dev-api/get-page-structure.ts');

    assert.match(peek, /<PhotoCarousel\s+initialSlide=\{1\}\s+peekPercent=\{20\}>/);
    assert.doesNotMatch(none, /peekPercent/);
    assert.match(clamped, /peekPercent=\{90\}/);
    assert.doesNotMatch(panorama, /peekPercent/);
    assert.match(getStructure, /peekPercent=\\\{\(\\d\+\)\\\}/);
});

test('mobile album media is full bleed while captions keep the content gutter', () => {
    const albumPage = readProjectFile('src/pages/[folder]/[album].astro');
    const devTool = readProjectFile('src/components/DevTool.astro');
    const layout = readProjectFile('src/layouts/Layout.astro');

    assert.match(albumPage, /@media \(max-width: 767px\)[\s\S]*?--album-mobile-gutter:\s*1rem/);
    assert.match(
        albumPage,
        /\.album-content > :global\(\.row-wrapper\),[\s\S]*?\.album-content > :global\(\.carousel-section\)[\s\S]*?margin-inline:\s*calc\(0rem - var\(--album-mobile-gutter\)\)/,
    );
    assert.match(
        albumPage,
        /:global\(\.carousel-section > \.photo-caption\)[\s\S]*?padding-inline:\s*var\(--album-mobile-gutter\)/,
    );
    assert.match(
        albumPage,
        /:global\(\.carousel-track\)[\s\S]*?--carousel-edge:\s*0px;[\s\S]*?scroll-padding-inline:\s*0/,
    );
    assert.match(
        albumPage,
        /:global\(\.carousel-track > \*\)[\s\S]*?flex-basis:\s*100%;[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*none/,
    );
    assert.match(
        albumPage,
        /@media \(min-width: 640px\) and \(max-width: 767px\)[\s\S]*?--album-mobile-gutter:\s*2rem/,
    );
    assert.match(
        devTool,
        /@media \(max-width: 767px\)[\s\S]*?\.dev-page-structure-preview \.carousel-track::before,[\s\S]*?\.dev-preview-as-carousel > \.photo-row::after[\s\S]*?display:\s*none/,
    );
    assert.match(
        devTool,
        /@media \(max-width: 767px\)[\s\S]*?\.dev-page-structure-preview \.carousel-track > \*,[\s\S]*?flex:\s*0 0 100% !important;[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*none/,
    );
    assert.match(
        layout,
        /@media \(max-width: 767px\)[\s\S]*?:root\s*\{[\s\S]*?scrollbar-gutter:\s*auto/,
    );
});

test('tagged photos reveal tags without a grey image overlay on hover or touch', () => {
    const photo = readProjectFile('src/components/Photo.astro');
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(photo, /\.photo-wrapper:hover \.tags-overlay\s*\{\s*opacity:\s*1/);
    assert.match(photo, /\.photo-wrapper\.show-info \.tags-overlay\s*\{\s*opacity:\s*1/);
    assert.doesNotMatch(
        photo,
        /\.photo-wrapper:hover \.tags-overlay\s*\{[^}]*background:/,
    );
    assert.doesNotMatch(
        photo,
        /\.photo-wrapper\.show-info \.tags-overlay\s*\{[^}]*background:/,
    );
    assert.doesNotMatch(
        devTool,
        /\.photo-wrapper:hover \.tags-overlay,[\s\S]*?\.photo-wrapper\.show-info \.tags-overlay\s*\{[^}]*background:/,
    );
    assert.doesNotMatch(
        devTool,
        /\.dev-block-overlay\.dev-tag-mode \.tags-overlay\s*\{[^}]*background:/,
    );
});

test('media block type chooser keeps abbreviated trigger and expands with full lowercase labels', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /dev-inline-margin-control[\s\S]*?dev-inline-block-type-control has-data[\s\S]*?\['Row', 'row'\][\s\S]*?\['PhotoCarousel', 'carousel'\][\s\S]*?\['PhotoPanorama', 'panorama'\]/,
    );
    assert.match(devTool, /\.dev-page-inline-add-zone \.dev-inline-block-type-options\s*\{[\s\S]*?flex-direction: row;/);
    assert.match(devTool, /const mediaBlockLabel = [\s\S]*?'row'[\s\S]*?'carousel'[\s\S]*?'panorama'/);
    assert.match(devTool, /const mediaBlockAbbreviation = [\s\S]*?'R'[\s\S]*?'C'[\s\S]*?'P'/);
    assert.match(devTool, /dev-inline-block-type-current[\s\S]*?\$\{mediaBlockAbbreviation\(displayedMediaType\)\}/);
    assert.match(devTool, /stageBlockType\(option\.dataset\.blockMode as MediaBlockType\)/);
    assert.match(devTool, /pendingBlockTypeChanges\.set\(typeChangeKey/);
    assert.match(devTool, /target\.type = change\.targetType/);
    assert.match(devTool, /pendingBlockTypeChanges\.size > 0/);
    assert.match(devTool, /const updateBlockTypePreview = \(/);
    assert.match(devTool, /updateBlockTypePreview\(targetMode, matchesFile\)/);
    assert.match(devTool, /\.dev-preview-as-carousel > \.photo-row[\s\S]*?scroll-snap-type: x mandatory/);
    assert.match(devTool, /\.dev-preview-as-row > \.carousel-track[\s\S]*?overflow: visible/);
    assert.match(devTool, /dev-preview-carousel-dots/);
    assert.match(devTool, /image\.naturalWidth \/ image\.naturalHeight/);
    assert.match(devTool, /restoreOriginalLayout\(\)/);
    assert.match(devTool, /const rowDefaultMargin = isLastAlbumBlock \? '0rem' : \(albumGap \|\| '0\.5rem'\)/);
    assert.match(devTool, /if \(isCarouselLikeType\(blockType\) \|\| blockType === 'Text'\) return '0\.5rem'/);
    assert.match(devTool, /if \(isCarouselLikeType\(targetType\)\) \{\s*if \(index > 0\) required\.add\(index - 1\);\s*required\.add\(index\)/);
    assert.match(devTool, /updateBlockTypePreview\(targetMode, matchesFile\);\s*reconcileAutomaticBlockMargins\(\)/);
    assert.match(devTool, /dev-preview-as-panorama/);
    assert.match(devTool, /dev-preview-panorama-controls/);
    assert.match(devTool, /dev-preview-as-panorama\[data-dev-preview-panorama-view="panorama"\]:hover \.tags-overlay/);
    assert.match(
        devTool,
        /updateMarginPreview\(findPendingMarginEntry\(\)\?\.\[1\]\.blockMargin \|\| originalBlockMargin\)/,
    );
    assert.match(devTool, /\.dev-block-toolbar \.dev-inline-block-type-control \{ --dev-toolbar-order: 4; \}/);
    assert.match(
        devTool,
        /\.dev-block-toolbar \.dev-toolbar-btn:not\(\.has-data\):not\(\.has-pending\),[\s\S]*?display: none;[\s\S]*?order: 0;/,
    );
    assert.match(
        devTool,
        /\.dev-block-overlay:hover > \.dev-block-toolbar \.dev-toolbar-btn,[\s\S]*?display: flex;/,
    );
    assert.match(devTool, /blockTypeControl\?\.classList\.toggle\('has-pending', !matchesFile\)/);
    assert.match(
        devTool,
        /blockElement\.addEventListener\('click',[\s\S]*?dev-preview-as-carousel[\s\S]*?slide\.hasAttribute\('data-active'\)[\s\S]*?event\.preventDefault\(\);\s*event\.stopImmediatePropagation\(\);[\s\S]*?track\.scrollTo/,
    );
});

test('Page Manager leaves block creation and destructive actions to inline controls', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.doesNotMatch(devTool, /block-add-photos|block-delete|initial-slide-btn|block-toggle/);
    assert.doesNotMatch(devTool, /dev-pm-native-photo-picker|openInlineBlockMenu|insertBlockAt/);
    assert.doesNotMatch(devTool, /data-page-gap-index="\$\{bIdx \+ 1\}" title="Add block here"/);
    assert.match(devTool, /data-page-gap-index="\$\{bIdx \+ 1\}" title="Move here"/);
});

test('pending layout and tag controls share the Edit blocks save state', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /\.dev-toolbar-btn\.has-pending,\s*\.dev-inline-margin-control\.has-pending\s*\{[\s\S]*?background: rgba\(234, 179, 8, 0\.9\)|\.dev-inline-block-type-control\.has-pending\s*\{[\s\S]*?background: rgba\(234, 179, 8, 0\.9\)/,
    );
    assert.match(
        devTool,
        /\.dev-save-btn\.has-pending,\s*\.dev-tag-toggle\.has-pending\s*\{[\s\S]*?background: rgba\(234, 179, 8, 0\.9\)/,
    );
    assert.match(devTool, /captionButton\?\.classList\.toggle\('has-pending', !matchesFile\)/);
    assert.match(devTool, /textButton\?\.classList\.toggle\('has-pending', !matchesFile\)/);
    assert.match(devTool, /marginControl\.classList\.toggle\('has-pending', !matchesFile\)/);
    assert.match(devTool, /tagToggle\.classList\.toggle\('has-pending', hasPendingTags\)/);
    assert.match(devTool, /saveBtn\.classList\.toggle\('has-pending', hasPendingEdits\)/);
    assert.match(devTool, /const savePendingChanges = async \(\) =>/);
    assert.doesNotMatch(devTool, /const savePendingTagChangesOnly = async/);
    assert.doesNotMatch(devTool, /const savePendingBlockChangesOnly = async/);
    assert.match(devTool, /let pendingLayoutChange: PendingPageStructureChange \| null = null;/);
    assert.match(devTool, /const block = toolbar\.closest<HTMLElement>\('\[data-dev-block\]'\)/);
});

test('pending inline edits warn before full loads and Astro page transitions', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /const hasPendingBlockChanges = \(\) => \([\s\S]*?pendingCaptionChanges\.size > 0[\s\S]*?pendingTextChanges\.size > 0[\s\S]*?pendingBlockMarginChanges\.size > 0[\s\S]*?pendingBlockTypeChanges\.size > 0[\s\S]*?pendingLayoutChange !== null[\s\S]*?const hasPendingChanges = \(\) => hasPendingTagChanges\(\) \|\| hasPendingBlockChanges\(\);/,
    );
    assert.match(devTool, /window\.addEventListener\('beforeunload', handlePendingBeforeUnload\)/);
    assert.match(devTool, /event\.preventDefault\(\);\s*\(event as any\)\.returnValue = ''/);
    assert.match(devTool, /document\.addEventListener\('astro:before-preparation', handlePendingBeforePreparation\)/);
    assert.match(
        devTool,
        /const handlePendingBeforePreparation[\s\S]*?if \(pendingSaveInProgress \|\| !hasPendingChanges\(\)\) return;[\s\S]*?event\.preventDefault\(\)/,
    );
    assert.match(devTool, /pendingSaveInProgress = true;\s*updateSaveButtonState\(true\)/);
    assert.match(devTool, /const blocksSaved = tagsSaved && await savePendingPageChanges\(albumSlug\);\s*pendingSaveInProgress = false/);
});

test('Page Manager and inline block controls share one pending layout draft', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /type PendingPageStructureChange = \{[\s\S]*?draft: PageStructureDraft;[\s\S]*?imports: File\[\]/);
    assert.match(devTool, /pendingLayoutChange !== null/);
    assert.match(devTool, /pendingLayoutChange = \{\s*albumSlug,\s*draft: JSON\.parse\(JSON\.stringify\(draft\)\),\s*imports: \[\.\.\.pendingPageImports\]/);
    assert.match(devTool, /structureChange\?\.imports\.forEach\(\(file\) => form\.append\('photos', file, file\.name\)\)/);
    assert.match(devTool, /removeLocal: structureChange\?\.draft\.removeLocal \|\| \[\]/);
    assert.match(devTool, /renderPendingPageStructure\(albumSlug, pendingLayoutChange\.draft, pendingLayoutChange\.imports\)/);
    assert.match(devTool, /type: 'Text',[\s\S]*?__devKey: `pending-\$\{crypto\.randomUUID\(\)\}`,[\s\S]*?props: \{ blockMargin: '1\.5rem' \}/);
    assert.match(devTool, /text\.style\.marginBottom = props\.blockMargin \|\| props\.mb \|\| '0\.5rem'/);
    assert.doesNotMatch(devTool, /const confirmHandler = async \(\) => \{[\s\S]{0,1500}?fetch\("\/api\/save-page-manager"/);
});

test('layout mode keeps block controls and order controls in one editing session', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /type AlbumEditMode = 'blocks' \| 'tags';/);
    assert.match(devTool, /const canStartEditMode = \(_target: AlbumEditMode\) => !pendingSaveInProgress;/);
    assert.match(devTool, /if \(!canStartEditMode\('blocks'\)\) return;/);
    assert.match(devTool, /const setLayoutEditMode = \(enabled: boolean\) => \{[\s\S]*?setBlockEditMode\(enabled\);[\s\S]*?setOrderEditMode\(enabled\);/);
    assert.match(devTool, /const updateEditModeAvailability = \(isSaving = pendingSaveInProgress\) =>/);
    assert.match(devTool, /\['dev-save-btn', 'dev-tag-toggle'\]\.forEach/);
    assert.match(devTool, /control\.classList\.remove\('dev-edit-mode-hidden'\)/);
    assert.match(devTool, /control\.classList\.toggle\('dev-edit-mode-unavailable', isSaving\)/);
    assert.match(devTool, /if \(control instanceof HTMLButtonElement\) control\.disabled = isSaving;/);
    assert.match(devTool, /\.dev-edit-mode-hidden\s*\{\s*display: none !important;/);
    assert.match(devTool, /\.dev-gear-btn\.dev-edit-mode-unavailable,[\s\S]*?pointer-events: none;/);
    assert.match(devTool, /document\.addEventListener\('keydown', pageManagerKeydownHandler\)/);
    assert.match(devTool, /document\.removeEventListener\('keydown', pageManagerKeydownHandler\)/);
});

test('inline order mode exposes manager, leveled moves, and cross-block photo grouping', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /const orderButton = document\.getElementById\('dev-save-btn'\);/);
    assert.match(devTool, /setOrderEditMode\(true\);/);
    assert.match(devTool, /managerButton\.title = 'Open order manager'/);
    assert.match(devTool, /managerButton\.innerHTML = ICONS\.order/);
    assert.match(devTool, /\.dev-order-actions\s*\{[\s\S]*?gap: 0\.75rem;/);
    assert.match(devTool, /createPhotoActionButton\('merge', 'Merge selected photos', ICONS\.mergeArrows\)/);
    assert.match(devTool, /createPhotoActionButton\('split', 'Split selected photos', ICONS\.splitArrows\)/);
    assert.match(devTool, /const createBlocksFromInlineOrderSelection = async/);
    assert.match(devTool, /const triggerInlinePhotoAction = \(action: Exclude<InlineOrderPhotoAction, null>\) =>/);
    assert.match(devTool, /button\.addEventListener\('click', \(\) => triggerInlinePhotoAction\(action\)\)/);
    assert.match(devTool, /const minimumSelection = action === 'merge' \? 2 : 1;/);
    assert.match(devTool, /inlineOrderSelectedPhotoNames\.size < minimumSelection/);
    assert.match(devTool, /selectedPhotos\.length < minimumSelection/);
    assert.match(devTool, /const hasSelection = isActive && inlineOrderSelectedPhotoNames\.size > 0;/);
    assert.match(devTool, /button\.innerHTML = hasSelection \? ICONS\.check : icon;/);
    assert.match(devTool, /if \(inlineOrderPhotoAction === action\) \{\s*if \(inlineOrderSelectedPhotoNames\.size === 0\) \{\s*clearInlineOrderInteraction\(\);\s*return;/);
    assert.match(devTool, /action === 'merge'\s*\? \[\{ type: 'Row'/);
    assert.match(devTool, /let inlineOrderMove: InlineOrderMove \| null = null;/);
    assert.match(devTool, /inlineOrderInteractionAbortController\?\.abort\(\)/);
    assert.match(devTool, /signal: interactionAbortController\.signal/);
    assert.match(devTool, /const clearInlineOrderInteraction = \(\) =>/);
    assert.match(devTool, /const cancelInlineOrderMove = \(\) => \{\s*if \(!inlineOrderMove\) return false;\s*inlineOrderMove = null;/);
    assert.match(devTool, /if \(cancelInlineOrderMove\(\)\) \{\s*event\.preventDefault\(\);/);
    assert.match(devTool, /const updateInlineFocusedActionState = \(\) =>/);
    assert.match(devTool, /html\.dev-inline-focused-action \.dev-page-inline-add-zone,[\s\S]*?\.dev-block-toolbar[\s\S]*?display: none !important;/);
    assert.match(devTool, /if \(activeTagMode\) return;\s*document\.querySelectorAll<HTMLElement>\('\.album-content \[data-dev-block\] \.photo-wrapper'\)/);
    assert.match(devTool, /const startInlineBlockPhotoAction = \([\s\S]*?clearInlineOrderInteraction\(\);/);
    assert.match(devTool, /wrapper\.addEventListener\('click', \(event\) => \{\s*if \(\(event\.target as HTMLElement\)\.closest\('\.dev-tag-edit-btn, \.tag-link'\)\) return;\s*if \(activeInlineBlockAction\) return;/);
    // Repeated clicks widen the selection; the drop target follows the selected level.
    assert.match(devTool, /level: 'photo', photoName, blockKey \} : \{ level: 'block', blockKey \}/);
    assert.match(devTool, /current\.level === 'photo' && wrapper && inlineOrderColumnOf\(wrapper\)[\s\S]*?level: 'column'/);
    assert.match(devTool, /inlineOrderMove = current\.level === 'block' \? null : \{ level: 'block', blockKey \};/);
    assert.match(devTool, /\(move\.level === 'column' && !isRow\)\) return null;/);
    assert.match(devTool, /const direction: MoveDirection = !isRow \|\| Math\.abs\(dx\) >= Math\.abs\(dy\)/);
    assert.match(devTool, /movePageBlock\(page\.draft\.blocks, move\.blockKey, drop\.targetBlockKey/);
    assert.match(devTool, /movePagePhotos\(\s*page\.draft\.blocks,\s*\{ level: move\.level, photoName: move\.photoName \}/);
    assert.match(devTool, /\.dev-order-drop-indicator\s*\{[\s\S]*?pointer-events: none;/);
    assert.doesNotMatch(devTool, /dev-order-block-move-zone|moveInlineOrderPhoto|inlineOrderMoveBlockKey/);
    assert.match(devTool, /dev-order-photo-selected[\s\S]*?outline: 3px solid #16a34a/);
    assert.match(devTool, /openPageManager\(true\)/);
});

test('inline editor provides F1 tag, F2 merge, and F3 split shortcuts', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /target\?\.closest\('dialog, input, textarea, select, \[role="textbox"\]'\)/);
    assert.match(devTool, /activeBlockEditMode[\s\S]*?activeOrderMode[\s\S]*?!isEditingText/);
    assert.match(devTool, /event\.key === 'F1'[\s\S]*?toggleInlineTagMode\(\)/);
    assert.match(devTool, /event\.key === 'F2'[\s\S]*?triggerInlinePhotoAction\('merge'\)/);
    assert.match(devTool, /event\.key === 'F3'[\s\S]*?triggerInlinePhotoAction\('split'\)/);
});

test('copied tags paste directly on right click and Escape clears the copy state', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /let copiedTagName: string \| null = null;/);
    assert.match(devTool, /const setCopiedTagName = \(name: string \| null\) =>/);
    assert.match(devTool, /html\.dev-tag-copy-active[\s\S]*?cursor: url\("data:image\/svg\+xml/);
    assert.match(devTool, /fill='%23facc15'/);
    assert.match(devTool, /M12 4v6M12 14v6M4 12h6M14 12h6/);
    assert.match(devTool, /const pasteCopiedTagAtPointer = \(e: MouseEvent, wrapper: HTMLElement\) =>/);
    assert.match(devTool, /if \(pasteCopiedTagAtPointer\(e as MouseEvent, wrapper as HTMLElement\)\) return;/);
    assert.match(devTool, /setCopiedTagName\(tagName\);/);
    assert.match(devTool, /if \(activeTagMode && copiedTagName\) \{[\s\S]*?setCopiedTagName\(null\);/);
});

test('page-level add controls expose every block gap and insert at the selected gap', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /\.dev-page-inline-add-zone--before/);
    assert.match(devTool, /\.dev-page-inline-add-menu\s*\{[\s\S]*?position: fixed;/);
    assert.match(devTool, /blocks\[0\]\.appendChild\(createAddZone\(0, true\)\)/);
    assert.match(devTool, /blocks\.forEach\(\(block, index\) => block\.appendChild\(createAddZone\(index \+ 1, false, block\)\)\)/);
    assert.match(devTool, /page\.draft\.blocks\.splice\(insertIndex, 0, newBlock\)/);
    assert.match(devTool, /openDirectBlockMenu\(\s*button,\s*insertIndex,/);
    assert.match(devTool, /dev-inline-margin-control, \.dev-inline-block-type-control/);
});

test('pending Text presentation follows its block identity after structure reordering', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /block\.__devKey \|\|= `persisted-\$\{index\}`/);
    assert.match(devTool, /text\.dataset\.devBlockKey = block\.__devKey/);
    assert.match(devTool, /const textIdentityMatches = \(change: PendingTextChange\) => \([\s\S]*?change\.blockKey === blockKey[\s\S]*?change\.originalText === fileText/);
    assert.match(devTool, /const stagedText = findPendingTextEntry\(\)\?\.\[1\]/);
    assert.match(devTool, /appendPendingRichText\(textContent, text\)/);
    assert.match(devTool, /const \{ __devKey: _devKey, \.\.\.persistedBlock \} = block/);
});

test('pending layout rendering restores breadcrumb anchors', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');
    const albumPage = readProjectFile('src/pages/[folder]/[album].astro');

    assert.match(devTool, /albumContent\.replaceChildren\(fragment\);\s*document\.dispatchEvent\(new CustomEvent\('album:content-replaced'\)\);/);
    assert.match(albumPage, /let breadcrumbObserver = initAlbumBreadcrumbs\(\);/);
    assert.match(
        albumPage,
        /document\.addEventListener\("album:content-replaced", \(\) => \{\s*breadcrumbObserver\?\.disconnect\(\);\s*breadcrumbObserver = initAlbumBreadcrumbs\(\);/,
    );
});

test('a newly added Text block immediately opens its editor', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /let pendingTextBlockEditorKey: string \| null = null;/);
    assert.match(devTool, /if \(type === 'Text'\) pendingTextBlockEditorKey = newBlock\.__devKey;/);
    assert.match(
        devTool,
        /if \(isTextBlock && pendingTextBlockEditorKey === blockKey\) \{\s*pendingTextBlockEditorKey = null;\s*openInlineTextEditor\(\);\s*\}/,
    );
});

test('persistent toolbar controls match the resting appearance of hovered empty controls', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /\.dev-toolbar-btn\.has-data\s*\{[\s\S]*?background: rgba\(255,255,255,0\.2\);[\s\S]*?border-color: rgba\(255,255,255,0\.3\);[\s\S]*?color: white;/,
    );
    assert.match(
        devTool,
        /\.dev-inline-margin-control\.has-data\s*\{[\s\S]*?background: rgba\(255,255,255,0\.2\);[\s\S]*?border-color: rgba\(255,255,255,0\.3\);/,
    );
    assert.match(devTool, /\.dev-toolbar-btn\.has-data:hover[\s\S]*?background: rgba\(59, 130, 246, 0\.8\)/);
    assert.match(devTool, /\.dev-inline-margin-control\.has-data:hover[\s\S]*?background: rgba\(59, 130, 246, 0\.8\)/);
});

test('direct caption editor uses a fixed four-line field with aligned controls', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /<textarea class="dev-inline-caption-text" rows="4" wrap="soft"/,
    );
    assert.match(devTool, /grid-template-rows: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.doesNotMatch(devTool, /block-caption-toggle|dev-pm-caption-editor/);
});

test('block captions and Text content open their direct editors on double click', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(devTool, /blockElement\.addEventListener\('dblclick', \(event\) =>/);
    assert.match(
        devTool,
        /target\.closest\('\.text-block__content'\)[\s\S]*?content\.parentElement !== blockElement[\s\S]*?openInlineTextEditor\(\)/,
    );
    assert.match(
        devTool,
        /target\.closest\('\.photo-caption'\)[\s\S]*?caption\.parentElement !== blockElement[\s\S]*?openInlineCaptionEditor\(\)/,
    );
});

test('all remaining spacing inputs use unitless rem values', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    for (const className of ['dev-inline-margin-input']) {
        assert.match(
            devTool,
            new RegExp(`class="${className}" type="number"`),
        );
    }
    assert.match(devTool, /class="dev-album-metadata-margin" type="number"/);
    assert.match(devTool, /gap: remValueFromInput\(defaultMarginValue\) \|\| undefined/);
    assert.doesNotMatch(devTool, /block-margin-caption/);
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
        /class="album-card folder-card group"[\s\S]*data-catalog-card[\s\S]*data-keyboard-navigation-target[\s\S]*data-mobile-direct/,
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
    const panorama = readProjectFile('src/components/PhotoPanorama.astro');
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
    assert.match(photoLightbox, /if \(image\.naturalWidth && image\.naturalHeight\)/);
    assert.match(photoLightbox, /new AbortController\(\)/);
    assert.match(photoLightbox, /lightbox\.destroy\(\)/);

    assert.match(
        photo,
        /<a[\s\S]*class="pswp-link block"[\s\S]*data-photo-lightbox-link/,
    );
    assert.match(photo, /data-pswp-width=\{width\}[\s\S]*data-pswp-height=\{height\}/);
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

    assert.match(panorama, /installPageLifecycle/);
    assert.match(panorama, /new AbortController\(\)/);
    assert.match(panorama, /resizeObservers\.forEach\(\(observer\) => observer\.disconnect\(\)\)/);
    assert.match(panorama, /frameIds\.forEach\(\(id\) => cancelAnimationFrame\(id\)\)/);
    assert.doesNotMatch(panorama, /astro:(?:before|after)-swap/);

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
        homePage,
        /<div class="album-cover">[\s\S]*<\/div>\s*<h2 class="folder-title">\{folder\.title\}<\/h2>/,
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
    assert.match(interactions, /card\.hasAttribute\("data-mobile-direct"\)/);
    assert.match(
        interactions,
        /card\.contains\(target\)[\s\S]*if \(!isInsideCurrentCard\)/,
    );
    assert.doesNotMatch(
        interactions,
        /document\.querySelectorAll[^;]*\.album-card/,
    );
});

test('album blocks use native margin collapsing for predictable spacing', () => {
    const albumPage = readProjectFile('src/pages/[folder]/[album].astro');
    const carousel = readProjectFile('src/components/PhotoCarousel.astro');
    const text = readProjectFile('src/components/Text.astro');

    assert.match(
        albumPage,
        /\.album-content\s*\{[^}]*display:\s*flow-root;/,
    );
    assert.doesNotMatch(
        albumPage,
        /\.album-content\s*\{[^}]*display:\s*flex;/,
    );
    assert.match(
        carousel,
        /const finalMT = mt \|\| \(hasTopCaption \? captionMargin : undefined\);/,
    );
    assert.match(
        carousel,
        /const finalMB = mb \|\| blockMargin \|\| \(hasBottomCaption \? captionMargin : undefined\);/,
    );
    assert.match(
        albumPage,
        /\*:has\(\+ \.carousel-section:not\(\.dev-preview-as-row\)\)[\s\S]*?margin-bottom:\s*1\.5rem/,
    );
    assert.doesNotMatch(carousel, /["']2rem["']/);
    assert.match(text, /const finalBlockMargin = blockMargin \|\| mb \|\| '0\.5rem'/);
    assert.doesNotMatch(text, /\bmt\??:|margin-top:/);
});

test("covered client scripts do not retain after-swap initializers", () => {
    const paths = [
        "src/pages/[folder]/[album].astro",
        "src/pages/yama/tags/[tag].astro",
        "src/components/MountainTagGrid.astro",
        "src/components/DevTool.astro",
        "src/components/MountainDevTool.astro",
        "src/components/Photo.astro",
        "src/components/Row.astro",
        "src/components/PhotoCarousel.astro",
        "src/components/PhotoPanorama.astro",
        "src/components/MountainProfile.astro",
    ];

    for (const path of paths) {
        assert.doesNotMatch(
            readProjectFile(path),
            /addEventListener\(["']astro:after-swap/,
            path,
        );
    }

    const mountainTagPage = readProjectFile(
        "src/pages/yama/tags/[tag].astro",
    );
    const albumPage = readProjectFile("src/pages/[folder]/[album].astro");
    assert.match(albumPage, /data-album-page/);
    assert.match(
        albumPage,
        /installPageLifecycle\(document, \(\) => \{\s*const page = document\.querySelector<HTMLElement>\(\s*"\[data-album-page\]"/,
    );
    assert.match(
        mountainTagPage,
        /installPageLifecycle\(document, \(\) => \{\s*const page = document\.querySelector<HTMLElement>\(\s*"\.tag-page\[data-tag-name\]"/,
    );
    assert.match(
        mountainTagPage,
        /fetch\("\/api\/mountain-cover",[\s\S]*signal,[\s\S]*if \(signal\.aborted\) return;/,
    );
    assert.match(mountainTagPage, /cancelAnimationFrame\(scrollResetFrame\)/);
    assert.match(
        mountainTagPage,
        /cancelAnimationFrame\(frameId\);[\s\S]*setCoverScrollReset\(false\);/,
    );
    assert.match(
        mountainTagPage,
        /cancelAnimationFrame\(scrollResetFrame\);[\s\S]*setCoverScrollReset\(false\);/,
    );
    assert.match(
        mountainTagPage,
        /clearScrollResetHandles\(\);\s*scrollResetFrame = requestAnimationFrame/,
    );
    assert.match(
        mountainTagPage,
        /return \(\) => \{[\s\S]*candidate\.disabled = Boolean\([\s\S]*status\.textContent = "";/,
    );

    const mountainTagGrid = readProjectFile(
        "src/components/MountainTagGrid.astro",
    );
    assert.match(
        mountainTagGrid,
        /const markReady = \(\) => \{[\s\S]*if \(controller\.signal\.aborted\) return;/,
    );
    assert.match(
        mountainTagGrid,
        /delete image\.dataset\.contourLoading/,
    );
    assert.match(
        mountainTagGrid,
        /sortGroups\(\);\s*updateButtons\(\);\s*return \(\) =>/,
    );
});

test("album photo grid keeps the shared previous and next navigation visible", () => {
    const albumPage = readProjectFile("src/pages/[folder]/[album].astro");

    assert.match(
        albumPage,
        /<AlbumPagination previous=\{previousAlbum\} next=\{nextAlbum\} \/>/,
    );
    assert.doesNotMatch(
        albumPage,
        /\.album-page\[data-grid-active="true"\][\s\S]{0,160}:global\(\.album-pagination\)\s*\{[\s\S]{0,80}display:\s*none/,
    );
});

test('sliced panoramas open the lightbox from their visible slices instead of the hidden source', () => {
    const lightbox = readProjectFile('src/components/PhotoLightbox.astro');

    assert.match(lightbox, /addFilter\("thumbBounds"/);
    assert.match(lightbox, /closest<HTMLElement>\("\[data-single-photo-sliced\]"\)/);
    assert.match(lightbox, /section\.dataset\.view !== "panorama"\) return fade/);
    assert.match(lightbox, /\.photo-panorama-slice \.photo-wrapper/);
    assert.match(lightbox, /return \{ x: left, y: top, w: right - left \}/);
});

const row = (...cells) => ({
    type: 'Row',
    __devKey: cells.map((cell) => [].concat(cell).join('+')).join('|'),
    props: {},
    photos: cells.flatMap((cell, index) => Array.isArray(cell)
        ? cell.map((name) => ({ itemKey: name, column: `c-${cell[0]}-${index}` }))
        : [{ itemKey: cell }]),
});
const layout = (blocks) => blocks.map((block) => rowCells(block.photos)
    .map(({ start, end, column }) => {
        const names = block.photos.slice(start, end).map((photo) => photo.itemKey);
        return column ? `[${names.join(' ')}]` : names[0];
    })
    .join(' '));
let columnIds = 0;
const nextColumnId = () => `new-${columnIds += 1}`;

test('row cells group consecutive column members and dissolve singletons', () => {
    assert.deepEqual(rowCells([
        { itemKey: 'a', column: 'x' },
        { itemKey: 'b', column: 'x' },
        { itemKey: 'c', column: 'y' },
        { itemKey: 'd' },
    ]), [{ start: 0, end: 2, column: 'x' }, { start: 2, end: 3 }, { start: 3, end: 4 }]);
});

test('serialized rows wrap column cells and leave other blocks flat', () => {
    const body = serializePageBody([
        row(['a', 'b'], 'c'),
        { type: 'PhotoCarousel', props: {}, photos: [{ itemKey: 'd', column: 'x' }, { itemKey: 'e', column: 'x' }] },
    ]);
    assert.equal(body, [
        '<Row>',
        '  <Column>',
        '    <Photo itemKey="a" />',
        '    <Photo itemKey="b" />',
        '  </Column>',
        '  <Photo itemKey="c" />',
        '</Row>',
        '',
        '<PhotoCarousel>',
        '  <Photo itemKey="d" />',
        '  <Photo itemKey="e" />',
        '</PhotoCarousel>',
    ].join('\n'));
});

test('photo moves join rows sideways and columns vertically', () => {
    let blocks = [row('a', 'b'), row('c')];
    assert.equal(movePagePhotos(blocks, { level: 'photo', photoName: 'c' }, 'a', 'down', nextColumnId), true);
    assert.deepEqual(layout(blocks), ['[a c] b']);

    blocks = [row(['a', 'b'], 'c')];
    movePagePhotos(blocks, { level: 'photo', photoName: 'c' }, 'a', 'down', nextColumnId);
    assert.deepEqual(layout(blocks), ['[a c b]']);

    blocks = [row(['a', 'b'], 'c')];
    movePagePhotos(blocks, { level: 'photo', photoName: 'c' }, 'b', 'left', nextColumnId);
    assert.deepEqual(layout(blocks), ['c [a b]']);

    blocks = [row(['a', 'b'], 'c')];
    movePagePhotos(blocks, { level: 'photo', photoName: 'a' }, 'c', 'right', nextColumnId);
    assert.deepEqual(layout(blocks), ['b c a']);
});

test('column moves keep the stack sideways and merge vertically', () => {
    let blocks = [row(['a', 'b'], 'c'), row('d')];
    movePagePhotos(blocks, { level: 'column', photoName: 'b' }, 'd', 'right', nextColumnId);
    assert.deepEqual(layout(blocks), ['c', 'd [a b]']);

    blocks = [row(['a', 'b'], ['c', 'd'])];
    movePagePhotos(blocks, { level: 'column', photoName: 'a' }, 'd', 'down', nextColumnId);
    assert.deepEqual(layout(blocks), ['[c d a b]']);

    blocks = [row(['a', 'b'], 'c')];
    movePagePhotos(blocks, { level: 'column', photoName: 'a' }, 'c', 'up', nextColumnId);
    assert.deepEqual(layout(blocks), ['[a b c]']);
});

test('invalid photo drops leave the layout untouched', () => {
    const blocks = [row(['a', 'b'], 'c'), { type: 'PhotoCarousel', __devKey: 'k', props: {}, photos: [{ itemKey: 'd' }] }];
    const snapshot = JSON.stringify(blocks);
    assert.equal(movePagePhotos(blocks, { level: 'column', photoName: 'a' }, 'b', 'left', nextColumnId), false);
    assert.equal(movePagePhotos(blocks, { level: 'photo', photoName: 'c' }, 'd', 'up', nextColumnId), false);
    assert.equal(movePagePhotos(blocks, { level: 'column', photoName: 'a' }, 'd', 'left', nextColumnId), false);
    assert.equal(JSON.stringify(blocks), snapshot);

    assert.equal(movePagePhotos(blocks, { level: 'photo', photoName: 'c' }, 'd', 'right', nextColumnId), true);
    assert.deepEqual(blocks.map((block) => block.photos.map((photo) => photo.itemKey)), [['a', 'b'], ['d', 'c']]);
});

test('block moves land above or below the target block', () => {
    const blocks = [row('a'), row('b'), row('c')];
    assert.equal(movePageBlock(blocks, 'c', 'a', 'up'), true);
    assert.deepEqual(blocks.map((block) => block.__devKey), ['c', 'a', 'b']);
    movePageBlock(blocks, 'c', 'b', 'down');
    assert.deepEqual(blocks.map((block) => block.__devKey), ['a', 'b', 'c']);
    assert.equal(movePageBlock(blocks, 'a', 'a', 'down'), false);
});
