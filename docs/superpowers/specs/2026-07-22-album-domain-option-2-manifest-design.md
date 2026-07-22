# Album Domain Option 2: Per-Album Manifest Design

## Status

Candidate design revised after review. This document does not authorize
implementation.

## Summary

Introduce one structured manifest per Album as the canonical source for Album
metadata, ordering, cover configuration, local photo inventory, captions, and
photo tags. Keep MDX for authored layout and prose, and keep R2 for image bytes.

The design deliberately keeps content ownership local:

- an Album's MDX content may render only photos below that Album's R2 prefix;
- Tag view may aggregate photos from any Album because it is a derived query,
  not another owner of those photos;
- an Album cover may use a photo from another Album through one explicit,
  narrowly scoped external reference;
- external photos cannot otherwise be inserted into Rows or Carousels.

This preserves the real cross-Album requirements without introducing a general
asset-ownership graph, ownership transfer, or cross-Album photo-use model.

## Problem Being Solved

Today an Album is distributed across MDX frontmatter, MDX component references,
`src/album-tags`, `_order.json`, and R2 naming conventions. A compatibility
catalog can hide those joins from consumers, but the physical sources can still
drift.

The manifest option makes mutable Album metadata structurally explicit and
co-located. MDX remains the layout document, while the adjacent manifest is the
validated inventory and metadata record for every local photo used by that
MDX.

The design must not confuse a cross-Album query with cross-Album ownership. Tag
view reads photos from their source Albums and renders their existing R2 URLs;
it does not add those photos to a new manifest or duplicate them in R2.

## Goals

- Establish one schema-valid structured record for every Album.
- Eliminate standalone album-tag sidecars and per-folder `_order.json` files.
- Keep Album photo rename, trash, and deletion primarily local operations.
- Preserve MDX for Rows, Carousels, Text blocks, and block-level captions.
- Let Tag view aggregate and edit tagged photos through their source Album.
- Permit an external cover without copying its R2 object.
- Preserve public routes, content layout, and existing R2 object keys during
  migration.

## Non-goals

- Inserting an external Album's photo into the current Album's Row or Carousel.
- Providing general shared-asset ownership or ownership transfer.
- Moving image bytes out of R2.
- Replacing MDX layout with JSON blocks.
- Supporting arbitrary dynamic MDX expressions.
- Refactoring unrelated mountain or client-lifecycle architecture.
- Retaining permanent dual-write compatibility after migration.

If authored cross-Album content becomes a demonstrated requirement later, it
should be designed as a new manifest schema version rather than anticipated in
version 1.

## Proposed Storage Layout

```text
src/content/albums/
  yama/
    2026-hakuba.mdx
    2026-hakuba.album.json
  k/
    2024-ldk.mdx
    2024-ldk.album.json
```

The shared basename is the Album ID. Folder and basename define the public
slug, so `/yama/2026-hakuba` remains unchanged.

After migration:

```text
src/album-tags/                   removed
src/content/albums/*/_order.json removed
```

## Manifest Schema

```ts
export type PhotoTag = {
  name: string;
  x: number;
  y: number;
};

export type LocalCoverPhoto = {
  kind: "local";
  filename: string;
};

export type ExternalCoverPhoto = {
  kind: "external";
  assetKey: `${string}/${string}/${string}`;
};

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
  photos: Array<{
    filename: string;
    caption?: string;
    tags?: PhotoTag[];
  }>;
};
```

Every `photos[].filename` is Album-relative and resolves to:

```text
<folder>/<album-id>/<filename>
```

Full R2 keys are forbidden in `photos`. They are permitted only in the
discriminated `cover.photo.kind === "external"` branch.

## Manifest Examples

Local cover:

```json
{
  "schemaVersion": 1,
  "title": "白馬",
  "info": "2026.2",
  "order": 40,
  "cover": {
    "photo": {
      "kind": "local",
      "filename": "KCS01475.jpg"
    },
    "zoom": 1,
    "offset": { "x": 50, "y": 30 }
  },
  "photos": [
    {
      "filename": "KCS01393.jpg",
      "tags": [
        { "name": "天狗岳", "x": 48.33, "y": 37.76 }
      ]
    },
    {
      "filename": "KCS01475.jpg"
    }
  ]
}
```

External cover:

```json
{
  "schemaVersion": 1,
  "title": "Referenced cover",
  "order": 20,
  "cover": {
    "photo": {
      "kind": "external",
      "assetKey": "yama/2026-hakuba/KCS01475.jpg"
    },
    "zoom": 1.15,
    "offset": { "x": 48, "y": 35 }
  },
  "photos": [
    {
      "filename": "KCS09901.jpg"
    }
  ]
}
```

The second manifest does not copy `KCS01475.jpg`, does not own its tags, and
cannot place it in content. It only stores a cover reference and its own crop.

## MDX Responsibility After Migration

MDX retains layout and prose:

```mdx
<PhotoCarousel initialSlide={1}>
  <Photo itemKey="KCS01311.jpg" />
  <Photo itemKey="KCS01322.jpg" />
</PhotoCarousel>

<Text size="title">松川</Text>

<Row caption="Album-level layout caption">
  <Photo itemKey="KCS01393.jpg" />
</Row>
```

The manifest owns photo-level caption and tag metadata. MDX owns placement,
Row/Carousel settings, prose, and block-level captions. Every MDX `Photo`
reference must be a static local filename present in `manifest.photos`. A
manifest photo must appear in MDX exactly once unless it is the selected local
cover; this permits an intentional cover-only source image without treating it
as Album content.

Frontmatter is reduced to the minimum required by Astro Content Collections, or
removed if the selected loader can associate MDX with its adjacent manifest.
Mutable Album metadata must not remain duplicated in frontmatter after cutover.

## Local Photo Resolution

The Album catalog is the only code that turns a local filename into a full R2
key:

```ts
export function resolveLocalPhoto(
  albumSlug: string,
  filename: string,
): ResolvedAlbumPhoto;
```

The resolved model contains the source Album identity, canonical `assetKey`,
caption, and tags. Presentation components receive this model and do not glob
manifest files or infer tag-sidecar paths.

For existing MDX syntax, the Album rendering boundary supplies the current
Album slug when resolving `<Photo itemKey="..." />`. A raw relative filename
must never be resolved from an unrelated route such as Tag view.

## Tag View Is a Derived Query

Tag view does not have a manifest and does not own photos. The catalog derives
its entries from source Album manifests:

```ts
export type TaggedPhoto = {
  sourceAlbumSlug: string;
  sourceAlbumTitle: string;
  filename: string;
  assetKey: string;
  caption?: string;
  tags: PhotoTag[];
};

export async function getTaggedPhotos(tagName: string): Promise<TaggedPhoto[]>;
```

Conceptual data flow:

```text
Album A manifest ─┐
Album B manifest ─┼─> catalog filters by tag ─> Tag view
Album C manifest ─┘
```

Tag view renders the returned full `assetKey`, so the browser requests the
original R2 object. No photo file or metadata is copied. The query considers
only photos referenced by MDX; a local cover-only manifest photo is not Album
content and does not appear in Tag view.

When tag editing starts from Tag view, the mutation includes
`sourceAlbumSlug + filename`. The catalog resolves and updates that source
manifest. Returning to either the source Album or Tag view then reads the same
metadata.

A Tag view entry remains grouped and linked by `sourceAlbumSlug`. It never
becomes a content photo of another Album simply because it appears in the
aggregate view.

## External Cover Resolution

An external cover is a narrow reference to a photo registered in another
tracked Album manifest:

```ts
export function resolveCover(
  album: AlbumManifestRecord,
  catalog: AlbumCatalog,
): ResolvedAlbumCover;
```

Resolution rules:

- a local cover filename must exist in the current manifest's `photos`;
- an external cover `assetKey` must resolve to exactly one source Album photo;
- external cover tags and captions remain owned by the source Album and are not
  copied into the consumer manifest;
- zoom and offset always belong to the consumer Album;
- an external cover is not returned by `getTaggedPhotos()` for the consumer
  Album because it is not part of that Album's content.

The catalog can find external cover references by scanning manifests:

```ts
export function getExternalCoverReferences(
  assetKey: string,
): AlbumSlug[];
```

A separate persisted reverse-reference index is unnecessary at the current
repository size.

## Proposed Code Boundaries

```text
src/lib/albums/
  manifest-schema.ts   versioned manifest parsing and field validation
  manifest-sources.ts  eager manifest loading and slug association
  mdx-photos.ts        static local Photo-reference extraction
  catalog.ts           Album, tag, and cover query API
  migration.ts         temporary legacy-to-manifest conversion helpers
  validation.ts        manifest, MDX, and external-cover invariants
  types.ts             consumer-facing normalized read models
  *.test.mjs
```

`migration.ts` is temporary. It is deleted after every tracked Album has a
validated manifest and no production reader uses legacy sources.

No `asset-index.ts`, asset-owner registry, or ownership-transfer service is
introduced.

## Runtime and Build Data Flow

```text
adjacent Album manifests ─> schema validation ─> normalized catalog
              MDX bodies ─> local-reference validation ─┘  ├─> home
                                                            ├─> folders
                                                            ├─> Albums
                                                            ├─> Tag view
                                                            └─> RSS

Album MDX filename ─> source Album manifest ─> original R2 object

Tag name ─> catalog query across source manifests ─> original R2 objects

external cover assetKey ─> one source Album photo ─> original R2 object
```

## Ordering Model

Each manifest contains a numeric `order`. Ordering is ascending; ties are an
error within the same folder. Reordering through DevTool rewrites the affected
folder's manifest order values into stable increments such as 10, 20, and 30.

This removes `_order.json` but makes a reorder touch multiple manifest files.
DevTool must validate all affected manifests before replacing any of them.

Folder navigation order remains in `FOLDER_METADATA`; it is outside the Album
manifest boundary.

## Schema and Validation Rules

The manifest loader validates before exposing any Album:

- `schemaVersion` must be a supported integer;
- title is non-empty and publication dates use ISO `YYYY-MM-DD`;
- folder and Album ID satisfy existing slug constraints;
- order is a finite integer unique within the folder;
- local filenames are unique, path-free, and use supported image extensions;
- every MDX photo reference is a static local filename;
- every normalized MDX photo reference exists in the manifest inventory;
- every manifest photo is referenced exactly once by MDX unless it is the
  selected local cover;
- a local cover exists in the current manifest's photos;
- an external cover is a normalized full R2 key resolving to one tracked source
  Album photo;
- zoom is positive and cover offsets range from 0 through 100;
- tag names are non-empty and coordinates range from 0 through 100;
- no tag metadata is stored on an external cover reference;
- no legacy `src/album-tags/<folder>/<album>.json` remains after cutover;
- no Album `_order.json` remains after cutover.

Diagnostics contain Album slug, manifest path, field path, and a stable error
code.

## Rename, Trash, and Deletion Rules

Local content ownership keeps destructive operations bounded:

- removing a local photo from an Album updates only that Album's MDX and
  manifest unless the photo is used as an external cover;
- renaming a local photo updates its source manifest, source MDX, R2 operation
  plan, and any matching external cover keys;
- trashing a photo is blocked while an external cover refers to it;
- deleting a source Album is blocked while another manifest uses one of its
  photos as an external cover;
- the conflict reports every consumer Album and requires changing or clearing
  those covers first;
- deletion never transfers ownership and never silently cascades into consumer
  Albums.

Because only covers can cross Album boundaries, destructive checks scan only
`cover.photo.kind === "external"` entries. They do not need a general reference
graph.

## Migration Strategy

The migration avoids a long-lived mixed source of truth:

1. Add the versioned manifest schema, normalized catalog API, and tests.
2. Build a one-shot converter that reads MDX frontmatter, local MDX photo
   references, tag sidecars, and `_order.json`.
3. Reject legacy cross-Album MDX photos and report them for explicit manual
   resolution; do not silently create generalized external photo uses.
4. Convert local covers to the `kind: "local"` branch.
5. Convert a cover whose full key belongs to another tracked Album to the
   `kind: "external"` branch without copying its R2 object.
6. Generate candidate manifests without deleting legacy sources.
7. Compare old and new normalized snapshots for every Album: slug, metadata,
   order, resolved cover key, photo keys, captions, and tags must match.
8. Change home, folder, Album, Tag view, Layout, RSS, and DevTool readers to the
   manifest-backed catalog.
9. Change DevTool writers to update manifests only.
10. Run the full suite and production build, then delete `src/album-tags`, Album
    `_order.json` files, migrated frontmatter fields, and migration code.
11. Add a guard test that fails if retired legacy storage reappears.

Steps 6 through 10 should be completed in one feature branch. Production must
not ship a state where some writers update manifests while readers still trust
legacy sidecars.

## DevTool Impact

This option changes editor persistence but keeps most operations Album-local:

- editing a local photo tag updates the source Album manifest;
- editing from Tag view sends source Album slug and filename to the same tag
  operation;
- editing cover crop updates only the consumer manifest;
- selecting a local cover stores a local filename;
- selecting an external cover stores the source photo's full `assetKey`;
- Row and Carousel insertion lists only the current Album's photos;
- renaming a photo updates matching external cover references as part of the
  validated operation plan;
- trash and source-Album deletion report blocking external covers;
- reordering Albums updates manifest order values;
- importing an Album creates adjacent MDX and manifest files;
- deleting an Album removes both files only after external cover conflicts are
  resolved.

Writes use the shared schema validator and deterministic JSON formatting. A
multi-file rename or reorder validates all proposed results before replacing
any tracked source file.

## Error Handling

- Invalid or unsupported manifest versions stop the build.
- A missing manifest is an error after cutover.
- An unknown or dynamic MDX photo reference is an error.
- A local MDX photo absent from the manifest is an error.
- A manifest photo absent from MDX is an error unless it is the selected local
  cover.
- An external content photo is an error in schema version 1.
- An unresolved external cover is an error.
- Rename, trash, and deletion return conflicts listing every blocking external
  cover; they never cascade silently.
- The migration converter never overwrites an existing manifest without an
  explicit overwrite option and a clean equivalence check.
- Production readers do not fall back to legacy sidecars after cutover.

## Testing Strategy

Schema tests cover every field boundary and union branch. Catalog tests verify
stable ordering, canonical local keys, tag queries, local covers, external
covers, and external-cover reference scans.

MDX/manifest fixtures verify:

- every MDX photo is present in manifest inventory;
- a manifest-only photo is accepted only when selected as local cover;
- rejection of full-path or dynamic MDX content photos;
- photo captions and tags loaded from the manifest;
- Row and Carousel rendering through local photo resolution;
- diagnostic source paths and stable error codes.

Tag view tests verify:

- photos from several source Albums appear in one result;
- every result keeps its source Album slug and original R2 key;
- one R2 key is rendered without copying data;
- a local cover-only photo is excluded from Tag view;
- editing a result updates only its source manifest;
- an external cover does not make a photo appear under the consumer Album in
  Tag view.

Mutation tests verify:

- external cover selection and independent crop settings;
- rename updates all matching external cover keys;
- trash and Album deletion are refused while external covers exist;
- clearing the external cover removes the conflict;
- no asset ownership or transfer state is created.

A repository-wide equivalence test compares normalized legacy and manifest
snapshots before legacy files are deleted. Static routes, generated cover URLs,
content photo order, and tag-photo groupings must remain identical.

## Benefits

- Strong physical source of truth without a generalized asset graph.
- Album content, tags, rename, and deletion remain locally understandable.
- Tag view retains full cross-Album aggregation without owning or copying data.
- The one demonstrated external reuse case—cover selection—is supported.
- External cover references remain visible and mechanically searchable.
- Future schema migrations have an explicit `schemaVersion` boundary.

## Costs and Residual Risks

- Every existing Album requires a generated and reviewed manifest.
- DevTool read and write paths must change in the same project.
- Photo filenames intentionally appear in both manifest inventory and MDX
  layout, requiring equality validation.
- Reordering one folder changes several manifest files.
- A source photo rename can touch consumer manifests with external covers.
- The external-cover exception is intentionally less flexible than a shared
  asset system.
- Temporary dual sources require strict snapshot comparison during migration.

## Success Criteria

- Every tracked Album has exactly one adjacent, schema-valid manifest.
- Album MDX content references only local photos.
- `src/album-tags` and Album `_order.json` files are retired.
- Tag view aggregates source Album photos through catalog queries without new
  manifests or duplicate R2 objects.
- External covers resolve to tracked source photos without copying R2 objects.
- No general photo-use ownership, transfer, or reverse-index subsystem exists.
- Every production consumer uses the manifest-backed catalog.
- DevTool reads and writes manifests exclusively.
- Public routes, R2 keys, cover rendering, tag groupings, and content layout are
  unchanged after migration.
- Repository-wide equivalence tests, Astro check, and production build pass.

## Recommendation Context

Choose this option when stronger physical data consistency is worth a
coordinated manifest migration, while cross-Album authored content is rare
enough to keep out of schema version 1. Tag view remains fully cross-Album
because it is a query projection, and external cover remains the single narrow
reuse exception.
