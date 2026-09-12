import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    applyDefaultCaptionBoundaryMargin,
    createLayoutOnlyPageContent,
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
    ]);

    assert.match(content, /<Text\s+align="left"\s+size="title"\s+blockMargin="1\.5rem">/);
    assert.doesNotMatch(content, /\smt=|\smb=/);
});

test('caption spacing is applied when direct block changes are saved', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /structure\.blocks\[targetIndex\]\.props = props;\s*if \(change\.caption\) applyDefaultCaptionBoundaryMargin\(structure\.blocks, targetIndex\)/,
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
        /dev-inline-margin-control[\s\S]*?dev-inline-margin-input[\s\S]*?dev-inline-margin-save/,
    );
    assert.match(devTool, /pendingBlockMarginChanges\.set\(marginChangeKey/);
    assert.match(
        devTool,
        /const fileEffectiveMargin = remValueFromInput\(remValueForInput\(originalBlockMargin \|\| visibleMargin\)\)/,
    );
    assert.match(devTool, /const expectedEffectiveMargin = originalBlockMargin[\s\S]*?defaultMarginForType\(displayedType\)/);
    assert.match(devTool, /const matchesFile = blockMargin === expectedEffectiveMargin/);
    assert.match(devTool, /if \(matchesFile\) \{\s*pendingBlockMarginChanges\.delete\(marginChangeKey\)/);
    assert.match(devTool, /updateMarginPreview\(matchesFile \? originalBlockMargin : blockMargin\)/);
    assert.match(devTool, /savePendingBlockChanges/);
    assert.match(devTool, /dev-inline-margin-control\.has-data:hover[\s\S]*?background: rgba\(59, 130, 246, 0\.8\)/);
    assert.match(devTool, /activeMarginControl && activeMarginControl !== marginControl[\s\S]*?classList\.remove\('is-open'\)/);
    assert.doesNotMatch(devTool, /block-margin-block|margin-block-reset/);
});

test('Page Manager delegates all Text settings to the direct Text toolbar', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');
    const text = readProjectFile('src/components/Text.astro');
    const getStructure = readProjectFile('src/dev-api/get-page-structure.ts');

    assert.doesNotMatch(devTool, /dev-pm-margin-control|text-block-mt|text-block-mb|text-block-content|text-block-align|text-block-size/);
    assert.match(devTool, /dev-btn-text[\s\S]*?dev-toolbar-text-icon[\s\S]*?>T</);
    assert.match(devTool, /dev-inline-text-input[\s\S]*?dev-inline-text-align[\s\S]*?dev-inline-text-type/);
    assert.match(devTool, /pendingTextChanges\.set\(textChangeKey/);
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

test('development block toolbar stacks tag editing above a bottom-aligned caption control', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /\.dev-block-toolbar\s*\{[\s\S]*?bottom:\s*0;[\s\S]*?left:\s*-2\.75rem;[\s\S]*?flex-direction:\s*column;/,
    );
    assert.match(
        devTool,
        /\.dev-block-overlay:hover > \.dev-block-toolbar,[\s\S]*?\.dev-block-toolbar\.has-caption/,
    );
    assert.match(devTool, /\.dev-block-overlay::before\s*\{[\s\S]*?left:\s*-3\.25rem;[\s\S]*?width:\s*3\.25rem;/);
    assert.match(devTool, /toolbar\.innerHTML = `[\s\S]*?dev-btn-tag[\s\S]*?dev-btn-caption/);
    assert.match(devTool, /const setBlockTagMode = \(block: HTMLElement\)/);
    assert.match(devTool, /activeTagBlock === block[\s\S]*?closeActiveTagBlock\(\)/);
    assert.match(devTool, /dev-block-overlay\.dev-tag-mode \.tags-overlay/);
    assert.match(devTool, /if \(!wrapper\.closest\('\.dev-tag-mode'\)\) return;/);
    assert.match(devTool, /editor\.className = 'dev-inline-caption-editor';/);
    assert.match(devTool, /blockElement\.insertBefore\(editor, captionAnchor\);/);
    assert.match(devTool, /pendingCaptionChanges\.set\(captionChangeKey/);
    assert.match(devTool, /const matchesFile = caption === fileCaption && captionPosition === fileCaptionPosition/);
    assert.match(devTool, /if \(matchesFile\) \{\s*pendingCaptionChanges\.delete\(captionChangeKey\)/);
    assert.match(devTool, /saveBtn\.addEventListener\('click', savePendingChanges\)/);
    assert.match(devTool, /sessionStorage\.setItem\('dev-caption-save-scroll-y'/);
});

test('media block type toggle is always last and saves through shared pending changes', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /dev-inline-margin-control[\s\S]*?dev-btn-block-type has-data[\s\S]*?displayedBlockType === 'Row' \? 'R' : 'C'/,
    );
    assert.match(devTool, /pendingBlockTypeChanges\.set\(typeChangeKey/);
    assert.match(devTool, /structure\.blocks\[targetIndex\]\.type = change\.targetType/);
    assert.match(devTool, /pendingBlockTypeChanges\.size > 0/);
    assert.match(devTool, /const updateBlockTypePreview = \(/);
    assert.match(devTool, /updateBlockTypePreview\(targetType, matchesFile\)/);
    assert.match(devTool, /\.dev-preview-as-carousel > \.photo-row[\s\S]*?scroll-snap-type: x mandatory/);
    assert.match(devTool, /\.dev-preview-as-row > \.carousel-track[\s\S]*?overflow: visible/);
    assert.match(devTool, /dev-preview-carousel-dots/);
    assert.match(devTool, /image\.naturalWidth \/ image\.naturalHeight/);
    assert.match(devTool, /restoreOriginalLayout\(\)/);
    assert.match(devTool, /const rowDefaultMargin = isLastAlbumBlock \? '0rem' : \(albumGap \|\| '0\.5rem'\)/);
    assert.match(devTool, /if \(blockType === 'PhotoCarousel'\) return '2rem'/);
    assert.match(
        devTool,
        /updateMarginPreview\(pendingBlockMarginChanges\.get\(marginChangeKey\)\?\.blockMargin \|\| originalBlockMargin\)/,
    );
    assert.match(devTool, /\.dev-block-toolbar \.dev-btn-block-type \{ --dev-toolbar-order: 4; \}/);
    assert.match(
        devTool,
        /\.dev-block-toolbar \.dev-toolbar-btn:not\(\.has-data\):not\(\.has-pending\),[\s\S]*?display: none;[\s\S]*?order: 0;/,
    );
    assert.match(
        devTool,
        /\.dev-block-overlay:hover > \.dev-block-toolbar \.dev-toolbar-btn,[\s\S]*?display: flex;/,
    );
    assert.match(devTool, /blockTypeButton\.classList\.toggle\('has-pending', !matchesFile\)/);
    assert.match(devTool, /blockEl\.querySelector\('\.block-toggle'\)\?\.addEventListener\('click'/);
});

test('pending block controls and the shared save action use the yellow state', () => {
    const devTool = readProjectFile('src/components/DevTool.astro');

    assert.match(
        devTool,
        /\.dev-toolbar-btn\.has-pending,\s*\.dev-inline-margin-control\.has-pending\s*\{[\s\S]*?background: rgba\(234, 179, 8, 0\.9\)/,
    );
    assert.match(
        devTool,
        /\.dev-save-btn\.has-pending\s*\{[\s\S]*?background: rgba\(234, 179, 8, 0\.9\)/,
    );
    assert.match(devTool, /captionButton\?\.classList\.toggle\('has-pending', !matchesFile\)/);
    assert.match(devTool, /textButton\?\.classList\.toggle\('has-pending', !matchesFile\)/);
    assert.match(devTool, /marginControl\.classList\.toggle\('has-pending', !matchesFile\)/);
    assert.match(devTool, /dev-btn-tag'\)\?\.classList\.toggle\('has-pending', hasPendingTags\)/);
    assert.match(devTool, /saveBtn\.classList\.toggle\('has-pending', hasPendingChanges\)/);
    assert.match(devTool, /\.dev-block-toolbar\.has-pending/);
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
    assert.match(devTool, /type="number" id="dev-pm-gap"/);
    assert.match(devTool, /gap: remValueFromInput\(fGap\.value\)/);
    assert.match(devTool, /gap: remValueFromInput\(fGap\.value\) \|\| undefined/);
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
        /const finalMT = mt \|\| \(hasTopCaption \? captionMargin : undefined\) \|\| ["']1\.5rem["'];/,
    );
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
