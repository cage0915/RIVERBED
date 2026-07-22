# Album Manifest Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace distributed Album frontmatter, tag sidecars, and order files with one slug-paired manifest per Album while keeping content photos local, deriving Tag view across source Albums, and allowing only external cover references.

**Architecture:** Pure manifest/schema and catalog-core modules validate injected records without Astro globals; a thin Astro source adapter joins manifests with MDX entries. A one-shot migration produces manifests and equivalence snapshots before production readers and DevTool writers cut over. Legacy files are deleted only after all readers and writers use manifests and repository-wide validation passes.

**Tech Stack:** Astro 4, TypeScript, MDX, Node.js built-in test runner, R2-compatible asset keys, existing Vite `import.meta.glob` source loading.

---

## File Map

New production modules:

- `src/lib/albums/types.ts`: manifest, normalized Album, diagnostic, and query types.
- `src/lib/albums/manifest-schema.ts`: pure parsing and validation of one manifest.
- `src/lib/albums/keys.ts`: Album slug, local filename, and external cover-key normalization.
- `src/lib/albums/mdx-photos.ts`: pure extraction of supported static local `<Photo>` references.
- `src/lib/albums/catalog-core.ts`: pure joins, ordering, tag projection, cover resolution, and external-cover scans.
- `src/lib/albums/catalog.ts`: Astro collection and `import.meta.glob` adapter exposing production queries.
- `src/lib/albums/manifest-files.ts`: Node-only manifest read/write helpers for Dev API routes.
- `src/lib/albums/validation.ts`: repository/build diagnostics assembled from schema, MDX, and catalog checks.

New tooling and tests:

- `scripts/migrate-album-manifests.mjs`: check/write/equivalence migration command.
- `src/lib/albums/*.test.mjs`: pure unit and fixture integration tests.
- `src/lib/album-manifest-repository.test.mjs`: repository-wide migration and retired-storage guard.

Modified consumers:

- `src/content/config.ts`, `src/pages/index.astro`, `src/pages/[folder]/index.astro`, `src/pages/[folder]/[album].astro`, `src/pages/rss.xml.ts`, `src/layouts/Layout.astro`.
- `src/components/Photo.astro`, `src/pages/yama/tags/[tag].astro`, `src/utils/tags.ts` (removed after cutover).
- Album-related Dev API routes and shared writer helpers listed in Tasks 7–9.

Generated migration output:

- `src/album-manifests/<folder>/<album>.json` for all 67 Albums. This parallel
  root avoids Astro 4's prohibition on mixing MDX content and JSON data entries
  inside one collection.
- MDX frontmatter reduced after the equivalence gate.
- `src/album-tags` and Album `_order.json` files removed only in Task 10.

## Task 1: Manifest Types, Keys, and Schema

**Files:**

- Create: `src/lib/albums/types.ts`
- Create: `src/lib/albums/keys.ts`
- Create: `src/lib/albums/manifest-schema.ts`
- Test: `src/lib/albums/manifest-schema.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add a failing schema test**

Cover valid local/external covers and reject paths in local filenames:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { parseAlbumManifest } from "./manifest-schema.ts";

const base = {
  schemaVersion: 1,
  title: "白馬",
  order: 10,
  cover: {
    photo: { kind: "local", filename: "KCS001.jpg" },
    zoom: 1,
    offset: { x: 50, y: 50 },
  },
  photos: [{ filename: "KCS001.jpg", tags: [{ name: "白馬岳", x: 50, y: 25 }] }],
};

test("parses local and external cover branches", () => {
  assert.equal(parseAlbumManifest(base, "yama/hakuba").cover.photo.kind, "local");
  const external = structuredClone(base);
  external.cover.photo = { kind: "external", assetKey: "yama/source/KCS002.jpg" };
  assert.equal(parseAlbumManifest(external, "yama/hakuba").cover.photo.kind, "external");
});

test("rejects non-local photo filenames", () => {
  const invalid = structuredClone(base);
  invalid.photos[0].filename = "yama/source/KCS001.jpg";
  assert.throws(() => parseAlbumManifest(invalid, "yama/hakuba"), /local filename/i);
});
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `node --test src/lib/albums/manifest-schema.test.mjs`

Expected: FAIL because `manifest-schema.ts` does not exist.

- [ ] **Step 3: Implement exact public types and validators**

Define the approved union in `types.ts`:

```ts
export type AlbumSlug = `${string}/${string}`;
export type PhotoTag = { name: string; x: number; y: number };
export type LocalCoverPhoto = { kind: "local"; filename: string };
export type ExternalCoverPhoto = { kind: "external"; assetKey: string };
export type AlbumManifest = {
  schemaVersion: 1;
  title: string;
  info?: string;
  publishedAt?: string;
  order: number;
  gap?: string;
  cover: {
    photo: LocalCoverPhoto | ExternalCoverPhoto;
    zoom: number;
    offset: { x: number; y: number };
  };
  photos: Array<{ filename: string; caption?: string; tags: PhotoTag[] }>;
};

export type ResolvedAlbumPhoto = {
  sourceAlbumSlug: AlbumSlug;
  sourceAlbumTitle: string;
  filename: string;
  assetKey: string;
  caption?: string;
  tags: PhotoTag[];
  isContent: boolean;
};

export type NormalizedAlbum = Omit<AlbumManifest, "cover" | "photos"> & {
  slug: AlbumSlug;
  folder: string;
  albumId: string;
  cover: AlbumManifest["cover"] & { assetKey: string };
  photos: ResolvedAlbumPhoto[];
};

export type TaggedPhoto = ResolvedAlbumPhoto & { isContent: true };
```

Implement `validateAlbumSlug`, `validateLocalPhotoFilename`, and
`normalizeAssetKey` in `keys.ts`. Implement `parseAlbumManifest(input,
albumSlug)` without type assertions escaping the module. Reject duplicate
filenames, non-finite coordinates, coordinates outside 0–100, empty tags,
invalid dates, invalid order, unsupported cover kinds, non-positive or
non-finite zoom, and local covers absent from `photos`. The DevTool may impose a
1–4 editing range, but the persisted manifest schema accepts every positive
finite zoom.

- [ ] **Step 4: Add a package test command and run the focused test**

Add:

```json
"test": "node --test src/lib/*.test.mjs src/lib/albums/*.test.mjs"
```

Run: `npm test -- --test-name-pattern='parses|rejects'`

Expected: PASS.

- [ ] **Step 5: Commit the schema boundary**

```bash
git add package.json src/lib/albums
git commit -m "feat: define album manifest schema"
```

## Task 2: MDX Photo Extraction and Cross-File Validation

**Files:**

- Create: `src/lib/albums/mdx-photos.ts`
- Create: `src/lib/albums/validation.ts`
- Test: `src/lib/albums/mdx-photos.test.mjs`
- Test: `src/lib/albums/validation.test.mjs`

- [ ] **Step 1: Write failing extractor tests**

```js
test("extracts static local Photo references in document order", () => {
  const body = `<Row>\n  <Photo itemKey="A.jpg" />\n  <Photo\n    itemKey='B.jpg'\n  />\n</Row>`;
  assert.deepEqual(extractMdxPhotos(body), ["A.jpg", "B.jpg"]);
});

test("rejects dynamic and full-path Photo references", () => {
  assert.throws(() => extractMdxPhotos(`<Photo itemKey={key} />`), /static string/i);
  assert.throws(() => extractMdxPhotos(`<Photo itemKey="yama/a/A.jpg" />`), /local filename/i);
});
```

- [ ] **Step 2: Run the extractor tests and confirm they fail**

Run: `node --test src/lib/albums/mdx-photos.test.mjs`

Expected: FAIL because the extractor is missing.

- [ ] **Step 3: Implement the project MDX Photo DSL extractor**

Return ordered filenames plus source offsets for diagnostics. Recognize
self-closing `Photo` elements with static single- or double-quoted `itemKey`.
Throw for a `Photo` without a static key, a dynamic expression, or a full path.
Do not attempt to become a general MDX parser.

- [ ] **Step 4: Write and implement inventory validation**

Expose:

```ts
export type AlbumDiagnostic = {
  code: string;
  message: string;
  albumSlug: string;
  sourcePath: string;
  fieldPath?: string;
};

export function validateAlbumInventory(input: {
  albumSlug: string;
  manifestPath: string;
  manifest: AlbumManifest;
  mdxPath: string;
  mdxBody: string;
}): AlbumDiagnostic[];
```

Every normalized MDX filename must exist in the manifest and preserve manifest
content order. A manifest filename absent from MDX is valid only when it is the
selected local cover. Report missing, unauthorized extra, reordered, or
duplicated entries with stable codes rather than silently repairing them.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test src/lib/albums/mdx-photos.test.mjs src/lib/albums/validation.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit extraction and validation**

```bash
git add src/lib/albums
git commit -m "feat: validate album manifests against mdx"
```

## Task 3: Pure Catalog Core and Tag Projection

**Files:**

- Create: `src/lib/albums/catalog-core.ts`
- Test: `src/lib/albums/catalog-core.test.mjs`

- [ ] **Step 1: Write failing catalog behavior tests**

Construct two in-memory Albums and assert:

```js
const catalog = createAlbumCatalog(records);
assert.deepEqual(catalog.getAlbumsInFolder("yama").map((album) => album.slug), [
  "yama/second",
  "yama/first",
]);
assert.deepEqual(catalog.getTaggedPhotos("白馬岳").map((photo) => photo.assetKey), [
  "yama/first/A.jpg",
  "yama/second/B.jpg",
]);
assert.deepEqual(catalog.getExternalCoverReferences("yama/first/A.jpg"), ["k/borrower"]);
```

Also assert that an external cover resolves only to a tracked source photo and
does not appear as content under the consumer Album in `getTaggedPhotos()`.

- [ ] **Step 2: Run the catalog test and confirm it fails**

Run: `node --test src/lib/albums/catalog-core.test.mjs`

Expected: FAIL because `createAlbumCatalog` is missing.

- [ ] **Step 3: Implement normalized records and catalog methods**

Expose:

```ts
export type AlbumSourceRecord = {
  slug: string;
  manifestPath: string;
  mdxPath: string;
  mdxBody: string;
  manifest: AlbumManifest;
};

export function createAlbumCatalog(records: AlbumSourceRecord[]): {
  getAlbum(slug: string): NormalizedAlbum | null;
  getAlbums(): NormalizedAlbum[];
  getAlbumsInFolder(folder: string): NormalizedAlbum[];
  getTaggedPhotos(tagName: string): TaggedPhoto[];
  getExternalCoverReferences(assetKey: string): string[];
  diagnostics: AlbumDiagnostic[];
};
```

Resolve every local photo to `${album.slug}/${filename}`. Sort by manifest
`order`, then slug. Resolve external covers after all records are indexed and
emit a diagnostic for missing source assets. Build Tag projection from MDX
content references, not every manifest inventory entry, so local cover-only
photos are excluded.

- [ ] **Step 4: Run focused tests**

Run: `node --test src/lib/albums/catalog-core.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the pure catalog**

```bash
git add src/lib/albums
git commit -m "feat: add normalized album catalog"
```

## Task 4: Migration Tool and Equivalence Gate

**Files:**

- Create: `scripts/migrate-album-manifests.mjs`
- Create: `src/lib/albums/legacy-source.js`
- Test: `src/lib/albums/legacy-source.test.mjs`
- Test: `src/lib/album-manifest-repository.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing legacy conversion tests**

Use a fixture containing frontmatter, MDX photos, tag sidecar, and order list.
Assert exact output:

```js
assert.deepEqual(convertLegacyAlbum(fixture), {
  schemaVersion: 1,
  title: "白馬",
  publishedAt: "2026-02-01",
  order: 20,
  cover: {
    photo: { kind: "local", filename: "A.jpg" },
    zoom: 1,
    offset: { x: 50, y: 30 },
  },
  photos: [{ filename: "A.jpg", tags: [{ name: "白馬岳", x: 50, y: 25 }] }],
});
```

Add a separate fixture where `coverKey` is a full key belonging to another
tracked Album and assert the external cover branch.

- [ ] **Step 2: Run and confirm the missing converter failure**

Run: `node --test src/lib/albums/legacy-source.test.mjs`

Expected: FAIL because `legacy-source.js` is missing.

- [ ] **Step 3: Implement deterministic legacy parsing and conversion**

Parse only the repository's supported frontmatter fields: `title`, `info`,
`publishedAt`, `order`, `coverKey`, `coverZoom`, `coverOffset`, and `gap`.
Reuse `extractMdxPhotos`. Join tag keys after normalizing bare and legacy full
paths. Reject stale tag keys and cross-Album MDX content references.

- [ ] **Step 4: Implement migration modes**

Add scripts:

```json
"albums:migrate:check": "node scripts/migrate-album-manifests.mjs check",
"albums:migrate:write": "node scripts/migrate-album-manifests.mjs write",
"albums:validate": "node scripts/migrate-album-manifests.mjs validate"
```

`check` prints planned manifest paths and diagnostics without writes. `write`
uses deterministic two-space JSON plus a trailing newline and refuses to
overwrite non-equivalent manifests. `validate` compares legacy and manifest
normalized snapshots.

- [ ] **Step 5: Run check mode and resolve every diagnostic**

Run: `npm run albums:migrate:check`

Expected: exit 0 with 67 candidate manifests and zero unresolved diagnostics.

The zero-diagnostic baseline includes seven explicit legacy-data repairs found
by the gate: six tag-sidecar photo keys absent from their Album MDX are removed
(`d2/KCS07180.jpg`, `hakuba/KCS01529.jpg`, `hakuba/KCS01544.jpg`,
`yangmin-ten-peaks/KCS00947.jpg`, `KCS01012.jpg`, and `KCS01061.jpg`), and the
`jiaminghu-1/KCS04452.jpg` tag coordinate is corrected from `y: -0.1` to `y: 0`.
The converter must continue rejecting both defect classes; it must not silently
repair future inputs.

- [ ] **Step 6: Generate manifests and run equivalence validation**

Run: `npm run albums:migrate:write && npm run albums:validate`

Expected: 67 manifests written; normalized slugs, metadata, covers, content
photo order, captions, and tags are equivalent to legacy sources. The known
local cover-only photo in `y/2026-keelungyu` remains inventory but is excluded
from content and Tag view; the `yama/2025-omoteginza-d3` cover becomes an
external reference to its `d2` source photo.

- [ ] **Step 7: Commit converter and generated manifests**

```bash
git add package.json scripts/migrate-album-manifests.mjs src/lib/albums src/lib/album-manifest-repository.test.mjs src/album-manifests src/album-tags docs/superpowers
git commit -m "feat: generate album manifests"
```

## Task 5: Astro Catalog Adapter and Production Catalog Pages

**Files:**

- Create: `src/lib/albums/catalog.ts`
- Modify: `src/content/config.ts`
- Modify: `src/pages/index.astro`
- Modify: `src/pages/[folder]/index.astro`
- Modify: `src/layouts/Layout.astro`
- Modify: `src/pages/rss.xml.ts`
- Test: `src/lib/album-manifest-repository.test.mjs`

- [ ] **Step 1: Add failing source-adapter contract assertions**

Extend the repository test to assert every MDX slug has exactly one paired
manifest and the catalog summaries match the legacy route, title, order, cover,
and publication snapshots.

- [ ] **Step 2: Implement the Astro source adapter**

Use eager globs:

```ts
const manifestModules = import.meta.glob(
  "/src/album-manifests/**/*.json",
  { eager: true },
);
```

Join by `/src/album-manifests/${album.slug}.json`, parse through
`parseAlbumManifest`, and create one cached catalog promise per build process.
Expose `getAlbumCatalog()`, `getAlbumSummaries()`, `getAlbumBySlug()`, and
`getTaggedPhotos()`.

- [ ] **Step 3: Cut home, folder, Layout, and RSS readers over**

Remove direct `_order.json` globs, cover-key normalization, and Album metadata
reads from Content Collection entries. Keep `getCollection("albums")` only
where Astro requires MDX entries for rendering/static path discovery.

- [ ] **Step 4: Run repository tests and Astro check**

Run: `npm test && npm exec astro check`

Expected: tests pass; Astro reports 0 errors.

- [ ] **Step 5: Build and snapshot route/cover output**

Run: `npm run build`

Expected: the same Album and Tag routes build; cover URLs resolve to the same R2
keys, including external-cover fixtures if present.

- [ ] **Step 6: Commit production catalog cutover**

```bash
git add src/content/config.ts src/lib/albums src/pages src/layouts
git commit -m "refactor: read album catalogs from manifests"
```

## Task 6: Album Photo Rendering and Tag View Cutover

**Files:**

- Modify: `src/pages/[folder]/[album].astro`
- Modify: `src/components/Photo.astro`
- Modify: `src/pages/yama/tags/[tag].astro`
- Delete: `src/utils/tags.ts`
- Test: `src/lib/albums/catalog-core.test.mjs`
- Test: `src/lib/album-manifest-repository.test.mjs`

- [ ] **Step 1: Add failing tag projection assertions**

Assert a shared tag across two manifests returns two entries with distinct
`sourceAlbumSlug` and original `assetKey`, and that an external cover does not
create a consumer-Album tag entry.

- [ ] **Step 2: Make Album rendering resolve local photos through catalog data**

Keep authored `<Photo itemKey="filename" />` syntax. Move manifest lookup and
local-key normalization out of the presentation component. The Album rendering
boundary provides source Album context; `Photo.astro` receives resolved
`assetKey`, caption, and tags and no longer globs `src/album-tags`.

- [ ] **Step 3: Switch Tag view to catalog projection**

Replace `getAllPhotosWithTags()` with `catalog.getTaggedPhotos(decodedTag)`.
Group by `sourceAlbumSlug`, render the returned full `assetKey`, and preserve
links to the source Album.

- [ ] **Step 4: Delete the regex/tag-sidecar utility and run tests**

Run: `npm test && npm exec astro check && npm run build`

Expected: all checks pass and Tag routes still render photos grouped by their
source Albums.

- [ ] **Step 5: Commit rendering and Tag view cutover**

```bash
git add src/components/Photo.astro src/pages src/lib/albums src/utils/tags.ts
git commit -m "refactor: render album photos from manifest catalog"
```

## Task 7: Tag and Caption Writers

**Files:**

- Create: `src/lib/albums/manifest-files.ts`
- Modify: `src/dev-api/get-data.ts`
- Modify: `src/dev-api/save-tags.ts`
- Modify: `src/dev-api/edit-tag.ts`
- Modify: `src/dev-api/edit-caption.ts`
- Modify: `src/dev-api/mountain-cover.ts`
- Test: `src/lib/albums/manifest-files.test.mjs`
- Test: `src/lib/dev-tag-state.test.mjs`
- Test: `src/lib/page-structure.test.mjs`

- [ ] **Step 1: Write failing atomic manifest mutation tests**

Test `readAlbumManifestFile`, `writeAlbumManifestFile`,
`updatePhotoTags`, and `updatePhotoCaption` against a temporary project root.
Require deterministic JSON and no file replacement when validation fails.

- [ ] **Step 2: Implement Node-only manifest file helpers**

Use explicit project roots and validated paths. Write to a sibling temporary
file, validate the serialized result, then rename over the target. Never expose
raw filesystem paths to request bodies.

- [ ] **Step 3: Cut tag and caption APIs over**

Tag view mutations identify the source with Album slug plus local filename.
`get-data.ts` builds its response from manifests. `save-tags.ts` and
`edit-tag.ts` mutate `manifest.photos[].tags`. Photo-level caption editing
mutates `manifest.photos[].caption`; block captions remain in MDX.

- [ ] **Step 4: Preserve mountain-cover source validation**

Replace tag-sidecar existence checks with catalog/manifest lookup of the source
Album photo while retaining the mountain JSON write behavior.

- [ ] **Step 5: Run focused APIs and full tests**

Run: `npm test`

Expected: new manifest mutation tests and existing route-state/tag-state tests
pass.

- [ ] **Step 6: Commit manifest metadata writers**

```bash
git add src/lib/albums src/dev-api
git commit -m "refactor: write photo metadata to manifests"
```

## Task 8: Cover and Folder-Order Writers

**Files:**

- Modify: `src/dev-api/save-album-cover.ts`
- Modify: `src/dev-api/save-folder-order.ts`
- Modify: `src/dev-api/get-folder-structure.ts`
- Modify: `src/components/DevTool.astro`
- Replace tests for `album-frontmatter.js` with manifest cover tests
- Delete after callers migrate: `src/lib/album-frontmatter.js`
- Delete after callers migrate: `src/lib/album-frontmatter.test.mjs`

- [ ] **Step 1: Write failing local/external cover mutation tests**

Assert local selection stores `{ kind: "local", filename }`, external selection
stores `{ kind: "external", assetKey }`, crop settings remain consumer-local,
and unresolved external keys are rejected.

- [ ] **Step 2: Switch cover APIs to manifest writes**

`save-album-cover.ts` resolves the submitted key through the catalog, chooses
the correct union branch, and writes `manifest.cover`. It does not edit MDX
frontmatter.

- [ ] **Step 3: Switch folder ordering to manifest order numbers**

Validate the complete requested folder list, assign 10/20/30 increments, build
all proposed manifests in memory, then replace files only after every proposed
manifest validates.

- [ ] **Step 4: Update DevTool payloads and local state**

Keep full resolved keys in picker button data. Let the server choose local vs
external representation. Update folder-card state from the response's resolved
cover without parsing frontmatter.

- [ ] **Step 5: Run tests, Astro check, and build**

Run: `npm test && npm exec astro check && npm run build`

Expected: all pass; local and external cover URLs are unchanged.

- [ ] **Step 6: Commit cover and order writers**

```bash
git add src/dev-api src/components/DevTool.astro src/lib
git commit -m "refactor: store covers and order in manifests"
```

## Task 9: Import, Rename, Delete, and R2 Safety

**Files:**

- Modify: `src/lib/album-import.js`
- Modify: `src/dev-api/import-album-photos.ts`
- Modify: `src/dev-api/rename-photos.ts`
- Modify: `src/dev-api/delete-album-page.ts`
- Modify: `src/dev-api/r2-album-plan.ts`
- Modify: `src/lib/r2-source-index.ts`
- Modify: `src/lib/r2-source-files.ts`
- Modify: `src/dev-api/save-page-manager.ts`
- Test: `src/lib/album-import.test.mjs`
- Test: `src/lib/r2-source-index.test.mjs`
- Test: `src/lib/albums/album-lifecycle.test.mjs`

- [ ] **Step 1: Write failing destructive-operation tests**

Assert rename updates source manifest filename, source MDX, R2 plan, and every
external cover key. Assert trash and source-Album deletion return a conflict
listing consumer Albums while external covers exist.

- [ ] **Step 2: Make imports create MDX and manifest together**

Create minimal MDX layout plus a slug-paired valid manifest with local cover,
photo inventory, empty tags, publication date, and next order increment. If
either proposed file fails validation, write neither.

- [ ] **Step 3: Make rename operate from a validated change plan**

Resolve all affected manifest/MDX/external-cover files first, validate proposed
contents, perform the R2 rename plan, then replace source files. Do not support
cross-Album content photos.

- [ ] **Step 4: Add external-cover conflict checks to trash and deletion**

Use `getExternalCoverReferences(assetKey)`. Return HTTP 409 with exact consumer
Album slugs. Do not clear or transfer covers automatically.

- [ ] **Step 5: Build R2 source indexes from manifests**

Index every manifest local photo and resolved cover. Remove frontmatter and tag
sidecar parsing. Ensure an external cover points at the original source key and
does not produce a duplicate object.

- [ ] **Step 6: Run focused and full verification**

Run: `npm test && npm exec astro check && npm run build`

Expected: all tests and build pass; conflict tests verify no silent cascade.

- [ ] **Step 7: Commit lifecycle writer cutover**

```bash
git add src/dev-api src/lib src/components/DevTool.astro
git commit -m "refactor: make album lifecycle manifest aware"
```

## Task 10: Remove Legacy Storage and Enforce the Boundary

**Files:**

- Modify mechanically: `src/content/albums/**/*.mdx`
- Delete: `src/album-tags/**/*.json`
- Delete: `src/content/albums/**/_order.json`
- Modify: `src/content/config.ts`
- Modify: `src/lib/page-structure.ts`
- Modify: `src/lib/r2-source-index.ts`
- Modify: `.gitignore` only if migration artifacts need an ignore rule
- Test: `src/lib/album-manifest-repository.test.mjs`
- Modify: root `README.md` or create it if absent

- [ ] **Step 1: Add failing retired-storage guard tests**

Assert there are no tracked paths matching `src/album-tags/**/*.json` or
`src/content/albums/**/_order.json`, and no MDX frontmatter contains `title`,
`coverKey`, `coverZoom`, `coverOffset`, `publishedAt`, `info`, `order`, or `gap`
after cutover.

- [ ] **Step 2: Reduce MDX frontmatter mechanically**

Use the migration script's `cleanup` mode to preserve the body byte-for-byte
while replacing migrated frontmatter with the minimal collection-compatible
form. Immediately run equivalence validation against committed manifest
snapshots.

- [ ] **Step 3: Delete sidecars and order files**

Remove the 44 tag sidecars and all Album `_order.json` files only after all
production and Dev API references are gone. Verify with:

```bash
rg -n 'src/album-tags|_order\.json|coverKey:' src scripts
```

Expected: no production or Dev API legacy reader/writer references; only
explicit migration/guard-test descriptions may remain.

- [ ] **Step 4: Tighten Content Collection and repository validation**

Make Astro content frontmatter accept only the minimal post-migration shape.
Run manifest/catalog validation as part of `prebuild` before contour preparation.

- [ ] **Step 5: Document the final data flow**

Create/update root `README.md` with:

```text
MDX = layout and prose
src/album-manifests/*.json = Album metadata, local photo inventory, tags, photo captions
R2 = image bytes
Tag view = derived catalog query
external cover = only supported persistent cross-Album photo reference
```

Document `npm run albums:validate`, import/rename/delete conflict behavior, and
manifest schema versioning.

- [ ] **Step 6: Run the complete verification gate**

Run:

```bash
npm test
npm run albums:validate
npm exec astro check
npm run build
git diff --check
```

Expected: all commands exit 0; 0 failed tests; 0 Astro errors; static build
completes; no legacy storage guard failures.

- [ ] **Step 7: Commit cleanup and documentation**

```bash
git add README.md package.json scripts src
git commit -m "refactor: complete album manifest migration"
```

## Task 11: Final Review and Production-Bundle Audit

**Files:**

- Modify only files required by review findings.

- [ ] **Step 1: Review the final diff against the approved design**

Confirm local-only MDX content, derived Tag view, external-cover-only reuse,
manifest-only metadata writes, and absence of generalized asset ownership.

- [ ] **Step 2: Audit generated output**

Search `dist` for retired sidecar paths and confirm representative local and
external cover URLs point to one original R2 key:

```bash
rg -n 'src/album-tags|_order\.json' dist
```

Expected: no matches.

- [ ] **Step 3: Re-run the complete verification gate**

Run:

```bash
npm test
npm run albums:validate
npm exec astro check
npm run build
git status --short
```

Expected: all verification succeeds and status contains only intentional
feature changes.

- [ ] **Step 4: Commit review fixes if any**

```bash
git add README.md package.json scripts src
git commit -m "fix: address album manifest migration review"
```

Do not create an empty commit when no review fix is necessary.
