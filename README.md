# RIVERBED

RIVERBED is a static Astro photo site. Album data follows one final, manifest-backed flow:

- One JSON manifest per Album in `src/album-manifests` holds its metadata, ordering, page layout (`blocks`), the local photo inventory, photo captions, and tags. The Page Manager in the dev server is the editor for these files.
- R2 contains the image bytes. A manifest references an existing object key; it does not copy image data.
- Tag view is a catalog query across source Album manifests. Tagged photos keep their source Album slug and original R2 key.
- An external cover is the only supported persistent cross-Album photo reference. Album Rows and Carousels may use only their own local inventory.

## Validation and build

Run `npm run albums:validate` after editing manifests. It validates schema version 2, checks that every block photo is in the inventory exactly once (an inventory photo may stay unplaced only as the local cover), rejects retired tag sidecars and Album MDX, and verifies that external covers resolve to tracked source photos.

`npm run build` runs the same Album validation before preparing contour assets and starting Astro. This prevents a production build from accepting an invalid or mixed legacy data state.

## Album editing rules

Album import creates a manifest with one Row per photo. Every edit (layout, metadata, cover, ordering, captions, tags) writes only to manifests. Renaming a photo updates its source manifest's inventory and blocks plus any external cover keys that reference it.

Trashing a photo or deleting its source Album returns a conflict while another Album uses that photo as an external cover. The conflict identifies each consumer Album; change those covers first. These operations never transfer ownership, clear references automatically, or duplicate an R2 object.

## Manifest versions

Every manifest has an explicit `schemaVersion`. Version 2 adds `blocks` (`Text`, `Row`, `PhotoCarousel`, `PhotoPanorama`), which replaced Album MDX; it keeps local content photos and the narrow external-cover exception. A future storage or cross-Album behavior change must introduce a deliberate schema migration and validator update.
