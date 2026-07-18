# Mountain contour assets

These SVG files cover a true 400m by 400m square centred on each summit. Source
elevations remain on a consistent 20 metre grid. During generation, the DEM is
bicubically interpolated to a clamped 5 metre working grid before contour
extraction, and the resulting lines are stored as cubic Bezier SVG paths. This
smooths the cartography without claiming additional terrain accuracy or relying
on browser-side cropping. Taiwan crops retain the summit's fractional position
within the native 20 metre DEM pixels, so the SVG centre matches the stored
coordinates instead of snapping to the nearest DEM cell. Japan tiles use the
same fractional-pixel sampling before forming the 20 metre source lattice. Do
not edit generated SVGs by hand.
Assets use their NFC-normalized mountain names as filenames, for example
`taiwan/玉山主峰.svg` and `japan/白馬岳.svg`.

- Taiwan uses the Ministry of the Interior 20m DTM from
  <https://data.gov.tw/dataset/35430/>.
- Japan uses the Geospatial Information Authority of Japan DEM10B elevation
  tiles, resampled from 10m to 20m:
  <https://maps.gsi.go.jp/development/ichiran.html#dem>.

Download and extract Taiwan's `dem_20m.tif`, then run:

```sh
npm run contours:generate -- --taiwan-dem /absolute/path/to/dem_20m.tif
```

Use `--region taiwan|japan` or `--mountain 山名` to generate a subset. GSI
tiles are cached under `/private/tmp/riverbed-gsi-dem-cache` by default.

In development, saving a mountain whose latitude or longitude changed calls the
same generator for that mountain. Set `TAIWAN_DEM_PATH` to the local
`dem_20m.tif` path so Taiwan contours can be refreshed automatically.
