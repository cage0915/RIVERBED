# RIVERBED

RIVERBED is a static Astro photo site. Album data follows one final, manifest-backed flow:

- Album MDX in `src/content/albums` contains layout and prose only.
- Slug-paired JSON in `src/album-manifests` contains Album metadata, ordering, the local photo inventory, photo captions, and tags.
- R2 contains the image bytes. A manifest references an existing object key; it does not copy image data.
- Tag view is a catalog query across source Album manifests. Tagged photos keep their source Album slug and original R2 key.
- An external cover is the only supported persistent cross-Album photo reference. Album Rows and Carousels may use only their own local inventory.

## Validation and build

Run `npm run albums:validate` after editing Album MDX or manifests. It requires exactly one manifest per MDX file, validates schema version 1 and the MDX inventory, rejects retired tag sidecars and `_order.json` files, and verifies that external covers resolve to tracked source photos.

`npm run build` runs the same Album validation before preparing contour assets and starting Astro. This prevents a production build from accepting an invalid or mixed legacy data state.

## Album editing rules

Album import creates the MDX and manifest together. Metadata edits, cover changes, ordering, photo captions, and tags write only to manifests. Renaming a photo updates its source MDX and manifest plus any external cover keys that reference it.

Trashing a photo or deleting its source Album returns a conflict while another Album uses that photo as an external cover. The conflict identifies each consumer Album; change those covers first. These operations never transfer ownership, clear references automatically, or duplicate an R2 object.

## Manifest versions

Every manifest has an explicit `schemaVersion`. Version 1 supports local content photos and the narrow external-cover exception. A future storage or cross-Album behavior change must introduce a deliberate schema migration and validator update; do not add compatibility fields to MDX frontmatter.
