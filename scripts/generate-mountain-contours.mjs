import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { fromFile as openGeoTiff } from "geotiff";
import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const GRID_SPACING_METRES = 20;
const GRID_WIDTH = 21;
const GRID_HEIGHT = 21;
const INTERPOLATION_SCALE = 4;
const WORKING_GRID_SPACING_METRES =
  GRID_SPACING_METRES / INTERPOLATION_SCALE;
const CONTOUR_INTERVAL_METRES = 20;
const INDEX_CONTOUR_INTERVAL_METRES = 100;
const SVG_WIDTH = 177;
const SVG_HEIGHT = 100;
const GSI_ZOOM = 14;
const GSI_TILE_URL =
  "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png";
const WEB_MERCATOR_RADIUS = 6_378_137;
const WEB_MERCATOR_CIRCUMFERENCE = 2 * Math.PI * WEB_MERCATOR_RADIUS;

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const selectedRegion = option("--region");
const selectedMountain = option("--mountain");
const overrideLatitude = option("--latitude");
const overrideLongitude = option("--longitude");
const debug = args.includes("--debug");
const outputRoot = path.resolve(
  PROJECT_ROOT,
  option("--output") ?? "public/contours",
);
const taiwanDemPath = option("--taiwan-dem") ?? process.env.TAIWAN_DEM_PATH;
const tileCacheRoot = path.resolve(
  option("--cache") ?? "/private/tmp/riverbed-gsi-dem-cache",
);

const hasCoordinateOverride =
  overrideLatitude !== undefined || overrideLongitude !== undefined;
const overriddenLocation = hasCoordinateOverride
  ? {
      latitude: Number(overrideLatitude),
      longitude: Number(overrideLongitude),
    }
  : null;
if (
  hasCoordinateOverride &&
  (!selectedMountain ||
    !Number.isFinite(overriddenLocation?.latitude) ||
    !Number.isFinite(overriddenLocation?.longitude) ||
    overriddenLocation.latitude < -90 ||
    overriddenLocation.latitude > 90 ||
    overriddenLocation.longitude < -180 ||
    overriddenLocation.longitude > 180)
) {
  throw new Error(
    "--latitude and --longitude require a selected mountain and valid coordinates",
  );
}

function assetName(name) {
  return name
    .normalize("NFC")
    .replaceAll("/", "／")
    .replaceAll("\\", "＼");
}

function interpolate(level, valueA, valueB, pointA, pointB) {
  const denominator = valueB - valueA;
  const amount = denominator === 0 ? 0.5 : (level - valueA) / denominator;
  return {
    x: pointA.x + (pointB.x - pointA.x) * amount,
    y: pointA.y + (pointB.y - pointA.y) * amount,
  };
}

function segmentsForLevel(values, width, height, level) {
  const segments = [];
  const edgePoint = (edge, x, y, corners) => {
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    if (edge === 0) {
      return interpolate(level, topLeft, topRight, { x, y }, { x: x + 1, y });
    }
    if (edge === 1) {
      return interpolate(
        level,
        topRight,
        bottomRight,
        { x: x + 1, y },
        { x: x + 1, y: y + 1 },
      );
    }
    if (edge === 2) {
      return interpolate(
        level,
        bottomLeft,
        bottomRight,
        { x, y: y + 1 },
        { x: x + 1, y: y + 1 },
      );
    }
    return interpolate(level, topLeft, bottomLeft, { x, y }, { x, y: y + 1 });
  };

  const add = (edgeA, edgeB, x, y, corners) => {
    segments.push({
      a: edgePoint(edgeA, x, y, corners),
      b: edgePoint(edgeB, x, y, corners),
      used: false,
    });
  };

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const corners = [
        values[y * width + x],
        values[y * width + x + 1],
        values[(y + 1) * width + x + 1],
        values[(y + 1) * width + x],
      ];
      if (corners.some((value) => !Number.isFinite(value))) continue;

      const mask =
        (corners[0] >= level ? 1 : 0) |
        (corners[1] >= level ? 2 : 0) |
        (corners[2] >= level ? 4 : 0) |
        (corners[3] >= level ? 8 : 0);
      if (mask === 0 || mask === 15) continue;

      const pairByMask = {
        1: [3, 0],
        2: [0, 1],
        3: [3, 1],
        4: [1, 2],
        6: [0, 2],
        7: [3, 2],
        8: [2, 3],
        9: [0, 2],
        11: [1, 2],
        12: [1, 3],
        13: [0, 1],
        14: [3, 0],
      };
      const pair = pairByMask[mask];
      if (pair) {
        add(pair[0], pair[1], x, y, corners);
        continue;
      }

      const centre = corners.reduce((sum, value) => sum + value, 0) / 4;
      if (mask === 5) {
        const pairs =
          centre >= level
            ? [
                [0, 1],
                [2, 3],
              ]
            : [
                [3, 0],
                [1, 2],
              ];
        pairs.forEach(([a, b]) => add(a, b, x, y, corners));
      } else if (mask === 10) {
        const pairs =
          centre >= level
            ? [
                [3, 0],
                [1, 2],
              ]
            : [
                [0, 1],
                [2, 3],
              ];
        pairs.forEach(([a, b]) => add(a, b, x, y, corners));
      }
    }
  }

  return segments;
}

function pointKey(point) {
  return `${point.x.toFixed(5)},${point.y.toFixed(5)}`;
}

function stitchSegments(segments) {
  const endpoints = new Map();
  segments.forEach((segment, index) => {
    for (const side of ["a", "b"]) {
      const key = pointKey(segment[side]);
      const items = endpoints.get(key) ?? [];
      items.push({ index, side });
      endpoints.set(key, items);
    }
  });

  const takeLine = (startIndex, startSide) => {
    const start = segments[startIndex];
    start.used = true;
    const points = [start[startSide], start[startSide === "a" ? "b" : "a"]];
    let currentKey = pointKey(points.at(-1));

    while (true) {
      const next = (endpoints.get(currentKey) ?? []).find(
        ({ index }) => !segments[index].used,
      );
      if (!next) break;
      const segment = segments[next.index];
      segment.used = true;
      const nextPoint = segment[next.side === "a" ? "b" : "a"];
      points.push(nextPoint);
      currentKey = pointKey(nextPoint);
      if (currentKey === pointKey(points[0])) break;
    }
    return points;
  };

  const lines = [];
  segments.forEach((segment, index) => {
    if (segment.used) return;
    const degreeA = endpoints.get(pointKey(segment.a))?.length ?? 0;
    const degreeB = endpoints.get(pointKey(segment.b))?.length ?? 0;
    if (degreeA === 1 || degreeB === 1) {
      lines.push(takeLine(index, degreeA === 1 ? "a" : "b"));
    }
  });
  segments.forEach((segment, index) => {
    if (!segment.used) lines.push(takeLine(index, "a"));
  });
  return lines;
}

function perpendicularDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0)
    return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function simplify(points, tolerance = 0.2) {
  if (points.length <= 2) return points;
  let farthestDistance = 0;
  let farthestIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(
      points[index],
      points[0],
      points.at(-1),
    );
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }
  if (farthestDistance <= tolerance) return [points[0], points.at(-1)];
  return [
    ...simplify(points.slice(0, farthestIndex + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(farthestIndex), tolerance),
  ];
}

function cubicInterpolate(a, b, c, d, amount) {
  const a0 = d - c - a + b;
  const a1 = a - b - a0;
  const a2 = c - a;
  return a0 * amount ** 3 + a1 * amount ** 2 + a2 * amount + b;
}

function gridValue(values, width, height, x, y) {
  const boundedX = Math.max(0, Math.min(width - 1, x));
  const boundedY = Math.max(0, Math.min(height - 1, y));
  return values[boundedY * width + boundedX];
}

function sampleElevationSurface(values, width, height, sourceX, sourceY) {
  const cellX = Math.min(width - 2, Math.max(0, Math.floor(sourceX)));
  const cellY = Math.min(height - 2, Math.max(0, Math.floor(sourceY)));
  const amountX = sourceX - cellX;
  const amountY = sourceY - cellY;
  const cellCorners = [
    gridValue(values, width, height, cellX, cellY),
    gridValue(values, width, height, cellX + 1, cellY),
    gridValue(values, width, height, cellX, cellY + 1),
    gridValue(values, width, height, cellX + 1, cellY + 1),
  ];

  if (cellCorners.some((value) => !Number.isFinite(value))) {
    const nearest = gridValue(
      values,
      width,
      height,
      Math.round(sourceX),
      Math.round(sourceY),
    );
    return Number.isFinite(nearest) ? nearest : Number.NaN;
  }

  const rows = [];
  for (let offsetY = -1; offsetY <= 2; offsetY += 1) {
    const row = [];
    for (let offsetX = -1; offsetX <= 2; offsetX += 1) {
      row.push(
        gridValue(
          values,
          width,
          height,
          cellX + offsetX,
          cellY + offsetY,
        ),
      );
    }
    rows.push(
      row.every(Number.isFinite)
        ? cubicInterpolate(...row, amountX)
        : cellCorners[0] +
            (cellCorners[1] - cellCorners[0]) * amountX,
    );
  }
  const interpolated = cubicInterpolate(...rows, amountY);
  return Math.max(
    Math.min(...cellCorners),
    Math.min(Math.max(...cellCorners), interpolated),
  );
}

// The source is still a 20m DEM. This creates a denser working surface for
// isoline extraction, while clamping every interpolated value to its source
// cell so cubic interpolation cannot invent peaks or depressions.
function resampleElevationGrid(values, width, height) {
  const outputWidth = (width - 1) * INTERPOLATION_SCALE + 1;
  const outputHeight = (height - 1) * INTERPOLATION_SCALE + 1;
  const output = [];

  for (let outputY = 0; outputY < outputHeight; outputY += 1) {
    const sourceY = outputY / INTERPOLATION_SCALE;
    for (let outputX = 0; outputX < outputWidth; outputX += 1) {
      const sourceX = outputX / INTERPOLATION_SCALE;
      output.push(
        sampleElevationSurface(values, width, height, sourceX, sourceY),
      );
    }
  }

  return { values: output, width: outputWidth, height: outputHeight };
}

function lineToPath(points, width, height) {
  const isClosed =
    points.length > 3 && pointKey(points[0]) === pointKey(points.at(-1));
  const simplified = simplify(points);
  if (
    isClosed &&
    simplified.length > 1 &&
    pointKey(simplified[0]) === pointKey(simplified.at(-1))
  ) {
    simplified.pop();
  }
  const scaled = simplified.map((point) => ({
    x: (point.x / (width - 1)) * SVG_WIDTH,
    y: (point.y / (height - 1)) * SVG_HEIGHT,
  }));
  if (scaled.length < 2) return "";
  const coordinate = (value) => value.toFixed(1).replace(/\.0$/, "");
  let pathData = `M${coordinate(scaled[0].x)} ${coordinate(scaled[0].y)}`;
  if (scaled.length === 2) {
    return `${pathData}L${coordinate(scaled[1].x)} ${coordinate(scaled[1].y)}`;
  }

  const segmentCount = isClosed ? scaled.length : scaled.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const previous = isClosed
      ? scaled[(index - 1 + scaled.length) % scaled.length]
      : scaled[Math.max(0, index - 1)];
    const start = scaled[index];
    const end = scaled[(index + 1) % scaled.length];
    const next = isClosed
      ? scaled[(index + 2) % scaled.length]
      : scaled[Math.min(scaled.length - 1, index + 2)];
    const controlA = {
      x: Math.max(
        0,
        Math.min(SVG_WIDTH, start.x + (end.x - previous.x) / 6),
      ),
      y: Math.max(
        0,
        Math.min(SVG_HEIGHT, start.y + (end.y - previous.y) / 6),
      ),
    };
    const controlB = {
      x: Math.max(
        0,
        Math.min(SVG_WIDTH, end.x - (next.x - start.x) / 6),
      ),
      y: Math.max(
        0,
        Math.min(SVG_HEIGHT, end.y - (next.y - start.y) / 6),
      ),
    };
    pathData += `C${coordinate(controlA.x)} ${coordinate(controlA.y)} ${coordinate(controlB.x)} ${coordinate(controlB.y)} ${coordinate(end.x)} ${coordinate(end.y)}`;
  }
  return isClosed ? `${pathData}Z` : pathData;
}

function renderSvg(values, width, height, metadata) {
  const valid = values.filter(Number.isFinite);
  if (valid.length < values.length * 0.45) {
    throw new Error("DEM crop contains too many missing elevation samples");
  }
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of valid) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const firstLevel =
    Math.ceil(minimum / CONTOUR_INTERVAL_METRES) * CONTOUR_INTERVAL_METRES;
  const paths = { minor: [], index: [] };

  for (
    let level = firstLevel;
    level <= maximum;
    level += CONTOUR_INTERVAL_METRES
  ) {
    const target =
      level % INDEX_CONTOUR_INTERVAL_METRES === 0 ? "index" : "minor";
    const lines = stitchSegments(
      segmentsForLevel(values, width, height, level),
    );
    for (const line of lines) {
      if (line.length < 2) continue;
      paths[target].push(lineToPath(line, width, height));
    }
  }

  const description = `${metadata.name} contours for a 400m by 400m area, generated from ${metadata.source} with a ${WORKING_GRID_SPACING_METRES}m interpolated working grid`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" preserveAspectRatio="none" role="presentation" data-boundary-metres="400" data-source-grid-spacing="${GRID_SPACING_METRES}" data-working-grid-spacing="${WORKING_GRID_SPACING_METRES}" data-contour-interval="${CONTOUR_INTERVAL_METRES}">`,
    `<desc>${description}</desc>`,
    `<path d="${paths.minor.join("")}" fill="none" stroke="#111827" stroke-opacity=".7" stroke-width=".42" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${paths.index.join("")}" fill="none" stroke="#111827" stroke-opacity=".7" stroke-width=".42" stroke-linecap="round" stroke-linejoin="round"/>`,
    "</svg>",
  ].join("");
}

// WGS84 and TWD97 use practically identical ellipsoids at this display scale.
function wgs84ToTwd97(latitude, longitude) {
  const a = 6_378_137;
  const inverseFlattening = 298.257222101;
  const flattening = 1 / inverseFlattening;
  const eccentricitySquared = 2 * flattening - flattening * flattening;
  const secondEccentricitySquared =
    eccentricitySquared / (1 - eccentricitySquared);
  const centralMeridian = (121 * Math.PI) / 180;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const longitudeRadians = (longitude * Math.PI) / 180;
  const sinLatitude = Math.sin(latitudeRadians);
  const cosLatitude = Math.cos(latitudeRadians);
  const tanLatitude = Math.tan(latitudeRadians);
  const n = a / Math.sqrt(1 - eccentricitySquared * sinLatitude ** 2);
  const t = tanLatitude ** 2;
  const c = secondEccentricitySquared * cosLatitude ** 2;
  const longitudeDistance = (longitudeRadians - centralMeridian) * cosLatitude;
  const e2 = eccentricitySquared;
  const meridionalArc =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latitudeRadians -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) *
        Math.sin(2 * latitudeRadians) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) *
        Math.sin(4 * latitudeRadians) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latitudeRadians));
  const scale = 0.9999;

  return {
    easting:
      250_000 +
      scale *
        n *
        (longitudeDistance +
          ((1 - t + c) * longitudeDistance ** 3) / 6 +
          ((5 - 18 * t + t ** 2 + 72 * c - 58 * secondEccentricitySquared) *
            longitudeDistance ** 5) /
            120),
    northing:
      scale *
      (meridionalArc +
        n *
          tanLatitude *
          (longitudeDistance ** 2 / 2 +
            ((5 - t + 9 * c + 4 * c ** 2) * longitudeDistance ** 4) / 24 +
            ((61 -
              58 * t +
              t ** 2 +
              600 * c -
              330 * secondEccentricitySquared) *
              longitudeDistance ** 6) /
              720)),
  };
}

async function createTaiwanSampler(demPath) {
  if (!demPath) {
    throw new Error(
      "Taiwan generation requires --taiwan-dem /path/to/dem_20m.tif or TAIWAN_DEM_PATH",
    );
  }
  const tiff = await openGeoTiff(demPath);
  const image = await tiff.getImage();
  if (image.getWidth() !== 10_175 || image.getHeight() !== 19_112) {
    throw new Error("Unexpected Taiwan 20m DTM dimensions");
  }
  const topLeftEasting = 148_320;
  const topLeftNorthing = 2_801_720;

  return async ({ latitude, longitude }) => {
    const { easting, northing } = wgs84ToTwd97(latitude, longitude);
    const centreX = (easting - topLeftEasting) / GRID_SPACING_METRES;
    const centreY = (topLeftNorthing - northing) / GRID_SPACING_METRES;
    const halfSourceSpan = (GRID_WIDTH - 1) / 2;
    const left = Math.floor(centreX - halfSourceSpan) - 1;
    const top = Math.floor(centreY - halfSourceSpan) - 1;
    const right = Math.floor(centreX + halfSourceSpan) + 3;
    const bottom = Math.floor(centreY + halfSourceSpan) + 3;
    if (debug) {
      process.stdout.write(
        `Taiwan DTM crop: easting ${easting.toFixed(2)}, northing ${northing.toFixed(2)}, fractional pixel ${centreX.toFixed(4)},${centreY.toFixed(4)}\n`,
      );
    }
    if (
      left < 0 ||
      top < 0 ||
      right > image.getWidth() ||
      bottom > image.getHeight()
    ) {
      throw new Error("Mountain crop is outside Taiwan DTM bounds");
    }
    const [samples] = await image.readRasters({
      window: [left, top, right, bottom],
      samples: [0],
    });
    const sourceValues = Array.from(samples, (value) =>
      value >= -500 && value <= 9_000 ? value : Number.NaN,
    );
    const sourceWidth = right - left;
    const sourceHeight = bottom - top;
    const workingWidth = (GRID_WIDTH - 1) * INTERPOLATION_SCALE + 1;
    const workingHeight = (GRID_HEIGHT - 1) * INTERPOLATION_SCALE + 1;
    const values = [];

    for (let y = 0; y < workingHeight; y += 1) {
      const sourceY =
        centreY +
        (y - (workingHeight - 1) / 2) / INTERPOLATION_SCALE -
        top;
      for (let x = 0; x < workingWidth; x += 1) {
        const sourceX =
          centreX +
          (x - (workingWidth - 1) / 2) / INTERPOLATION_SCALE -
          left;
        values.push(
          sampleElevationSurface(
            sourceValues,
            sourceWidth,
            sourceHeight,
            sourceX,
            sourceY,
          ),
        );
      }
    }
    return {
      values,
      width: workingWidth,
      height: workingHeight,
      source: "Taiwan MOI 20m DTM",
      isWorkingGrid: true,
    };
  };
}

function coordinatesToGlobalPixels(latitude, longitude, zoom) {
  const worldSize = 256 * 2 ** zoom;
  const latitudeRadians = (latitude * Math.PI) / 180;
  return {
    x: ((longitude + 180) / 360) * worldSize,
    y: ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * worldSize,
    worldSize,
  };
}

async function loadGsiTile(x, y) {
  const cachePath = path.join(
    tileCacheRoot,
    String(GSI_ZOOM),
    String(x),
    `${y}.png`,
  );
  let data;
  try {
    data = await fs.readFile(cachePath);
  } catch {
    const url = GSI_TILE_URL.replace("{z}", String(GSI_ZOOM))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`GSI tile ${x}/${y}: HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, data);
  }
  const { data: pixels } = await sharp(data)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return pixels;
}

async function sampleJapan({ latitude, longitude }) {
  const centre = coordinatesToGlobalPixels(latitude, longitude, GSI_ZOOM);
  const groundMetresPerPixel =
    (WEB_MERCATOR_CIRCUMFERENCE * Math.cos((latitude * Math.PI) / 180)) /
    centre.worldSize;
  const halfWidthPixels =
    ((GRID_WIDTH - 1) * GRID_SPACING_METRES) / (2 * groundMetresPerPixel);
  const halfHeightPixels =
    ((GRID_HEIGHT - 1) * GRID_SPACING_METRES) / (2 * groundMetresPerPixel);
  const interpolationHaloPixels = 3;
  const minimumTileX = Math.floor(
    (centre.x - halfWidthPixels - interpolationHaloPixels) / 256,
  );
  const maximumTileX = Math.floor(
    (centre.x + halfWidthPixels + interpolationHaloPixels) / 256,
  );
  const minimumTileY = Math.floor(
    (centre.y - halfHeightPixels - interpolationHaloPixels) / 256,
  );
  const maximumTileY = Math.floor(
    (centre.y + halfHeightPixels + interpolationHaloPixels) / 256,
  );
  const tiles = new Map();

  await Promise.all(
    Array.from(
      { length: maximumTileX - minimumTileX + 1 },
      (_, xOffset) => minimumTileX + xOffset,
    ).flatMap((tileX) =>
      Array.from(
        { length: maximumTileY - minimumTileY + 1 },
        (_, yOffset) => minimumTileY + yOffset,
      ).map(async (tileY) => {
        tiles.set(`${tileX}/${tileY}`, await loadGsiTile(tileX, tileY));
      }),
    ),
  );

  const elevationAtPixel = (globalPixelX, globalPixelY) => {
    const tileX = Math.floor(globalPixelX / 256);
    const tileY = Math.floor(globalPixelY / 256);
    const pixelX = ((globalPixelX % 256) + 256) % 256;
    const pixelY = ((globalPixelY % 256) + 256) % 256;
    const pixels = tiles.get(`${tileX}/${tileY}`);
    if (!pixels) return Number.NaN;
    const offset = (pixelY * 256 + pixelX) * 3;
    const encoded =
      pixels[offset] * 2 ** 16 +
      pixels[offset + 1] * 2 ** 8 +
      pixels[offset + 2];
    return encoded === 2 ** 23
      ? Number.NaN
      : (encoded < 2 ** 23 ? encoded : encoded - 2 ** 24) * 0.01;
  };

  const sampleGsiSurface = (globalX, globalY) => {
    // Web Mercator pixel coordinates describe raster edges; DEM samples sit at
    // pixel centres, hence the half-pixel offset before cubic interpolation.
    const rasterX = globalX - 0.5;
    const rasterY = globalY - 0.5;
    const baseX = Math.floor(rasterX);
    const baseY = Math.floor(rasterY);
    const neighbourhood = [];
    for (let y = -1; y <= 2; y += 1) {
      for (let x = -1; x <= 2; x += 1) {
        neighbourhood.push(elevationAtPixel(baseX + x, baseY + y));
      }
    }
    return sampleElevationSurface(
      neighbourhood,
      4,
      4,
      1 + (rasterX - baseX),
      1 + (rasterY - baseY),
    );
  };

  const values = [];
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    const globalY =
      centre.y +
      ((y - (GRID_HEIGHT - 1) / 2) * GRID_SPACING_METRES) /
        groundMetresPerPixel;
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const globalX =
        centre.x +
        ((x - (GRID_WIDTH - 1) / 2) * GRID_SPACING_METRES) /
          groundMetresPerPixel;
      values.push(sampleGsiSurface(globalX, globalY));
    }
  }
  return {
    values,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    source: "GSI DEM10B resampled to 20m",
  };
}

async function loadMountains(region) {
  const filePath = path.join(PROJECT_ROOT, "src/mountains", `${region}.json`);
  const mountains = JSON.parse(await fs.readFile(filePath, "utf8"));
  return mountains
    .filter(
      (mountain) =>
        (overriddenLocation ||
          (Number.isFinite(mountain.location?.latitude) &&
            Number.isFinite(mountain.location?.longitude))) &&
        (!selectedMountain || mountain.name === selectedMountain),
    )
    .map((mountain) =>
      overriddenLocation
        ? { ...mountain, location: { ...mountain.location, ...overriddenLocation } }
        : mountain,
    );
}

async function main() {
  const regions = selectedRegion ? [selectedRegion] : ["taiwan", "japan"];
  const taiwanSampler = regions.includes("taiwan")
    ? await createTaiwanSampler(taiwanDemPath)
    : null;
  let generated = 0;

  for (const region of regions) {
    if (region !== "taiwan" && region !== "japan") {
      throw new Error(`Unsupported contour region: ${region}`);
    }
    const mountains = await loadMountains(region);
    const outputDirectory = path.join(outputRoot, region);
    await fs.mkdir(outputDirectory, { recursive: true });
    for (const mountain of mountains) {
      const sample =
        region === "taiwan"
          ? await taiwanSampler(mountain.location)
          : await sampleJapan(mountain.location);
      const workingGrid = sample.isWorkingGrid
        ? sample
        : resampleElevationGrid(
            sample.values,
            sample.width,
            sample.height,
          );
      if (debug) {
        const valid = sample.values.filter(Number.isFinite);
        const range = valid.reduce(
          (current, value) => ({
            minimum: Math.min(current.minimum, value),
            maximum: Math.max(current.maximum, value),
          }),
          {
            minimum: Number.POSITIVE_INFINITY,
            maximum: Number.NEGATIVE_INFINITY,
          },
        );
        process.stdout.write(
          `${mountain.name}: centre ${sample.values[Math.floor(sample.height / 2) * sample.width + Math.floor(sample.width / 2)]}m, range ${range.minimum}..${range.maximum}m, ${valid.length}/${sample.values.length} valid samples\n`,
        );
      }
      const svg = renderSvg(
        workingGrid.values,
        workingGrid.width,
        workingGrid.height,
        {
          name: mountain.name,
          source: sample.source,
        },
      );
      await fs.writeFile(
        path.join(outputDirectory, `${assetName(mountain.name)}.svg`),
        svg,
      );
      generated += 1;
      process.stdout.write(`Generated ${region}/${mountain.name}\n`);
    }

    if (!selectedMountain) {
      const generatedNames = new Set(
        mountains.map((mountain) => `${assetName(mountain.name)}.svg`),
      );
      const existingFiles = await fs.readdir(outputDirectory);
      await Promise.all(
        existingFiles
          .filter(
            (file) =>
              file.endsWith(".svg") && !generatedNames.has(file),
          )
          .map((file) => fs.unlink(path.join(outputDirectory, file))),
      );
    }
  }
  process.stdout.write(
    `Generated ${generated} contour SVG files from 20m source data with a ${WORKING_GRID_SPACING_METRES}m interpolated working grid.\n`,
  );
}

await main();
