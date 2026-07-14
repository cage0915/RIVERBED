# Mountain map sources

The outline SVGs are generated from the simplified ADM1 GeoJSON published by
[geoBoundaries](https://www.geoboundaries.org/). The underlying boundaries are
derived from OpenStreetMap and licensed under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

Source snapshots:

- [Taiwan simplified GeoJSON](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/TWN/ADM1/geoBoundaries-TWN-ADM1_simplified.geojson): boundary `TWN-ADM1-90331920`, geoBoundaries build dated 2023-12-12.
- [Japan simplified GeoJSON](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/JPN/ADM1/geoBoundaries-JPN-ADM1_simplified.geojson): boundary `JPN-ADM1-47310658`, geoBoundaries build dated 2023-12-12.
- Both snapshots are pinned to geoBoundaries release commit `9469f09`.

The source GeoJSON stays out of the production bundle. To regenerate the SVGs,
download the pinned simplified files to a temporary directory and run:

```sh
node scripts/generate-mountain-map-svg.mjs \
  /tmp/riverbed-taiwan-adm1.geojson \
  public/maps/taiwan-outline.svg \
  "Taiwan administrative boundaries"

node scripts/generate-mountain-map-svg.mjs \
  /tmp/riverbed-japan-adm1.geojson \
  public/maps/japan-outline.svg \
  "Japan administrative boundaries"
```

Required public attribution is rendered by `MountainMap.astro`.

Map sources remain code-owned in `src/lib/mountain-map.ts`. Editable context
metadata lives in `src/map-contexts.json`; each context directly stores its source,
geographic bounds, level, and optional feature filter. The development-only mountain
manager can update an existing context's ID, label and geographic bounds, or save
the current viewport as a new shared context without rewriting TypeScript. Context
ID changes migrate mountain references. The `tw-full` and `jp-full` contexts are
code-owned creation bases and cannot be deleted through DevTool. Deleting another
context preserves mountain coordinates and references; pages suppress the location
map until a valid context is assigned. SVG `viewBox` values are runtime rendering
details and are not persisted as mountain data.
