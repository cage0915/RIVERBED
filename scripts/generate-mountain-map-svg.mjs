import fs from "node:fs";
import path from "node:path";

const WORLD_SIZE = 10_000;
const MAX_LATITUDE = 85.05112878;
// World-space tolerance: 0.12 units is roughly 480 m at the equator. The
// profile map is intentionally minimal, so this keeps the cached master SVGs
// compact while preserving prefecture/county silhouettes.
const SIMPLIFICATION_TOLERANCE = 0.12;

const [inputPath, outputPath, title = "Administrative boundaries"] = process.argv.slice(2);

if (!inputPath || !outputPath) {
    console.error(
        "Usage: node scripts/generate-mountain-map-svg.mjs <input.geojson> <output.svg> [title]",
    );
    process.exit(1);
}

const geoJson = JSON.parse(fs.readFileSync(inputPath, "utf8"));
if (geoJson.type !== "FeatureCollection" || !Array.isArray(geoJson.features)) {
    throw new Error("Expected a GeoJSON FeatureCollection");
}

const projectedExtent = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
};

function project([longitude, latitude]) {
    const clampedLatitude = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
    const latitudeRadians = (clampedLatitude * Math.PI) / 180;
    const point = [
        ((longitude + 180) / 360) * WORLD_SIZE,
        ((1 -
            Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) /
                Math.PI) /
            2) *
            WORLD_SIZE,
    ];
    projectedExtent.minX = Math.min(projectedExtent.minX, point[0]);
    projectedExtent.minY = Math.min(projectedExtent.minY, point[1]);
    projectedExtent.maxX = Math.max(projectedExtent.maxX, point[0]);
    projectedExtent.maxY = Math.max(projectedExtent.maxY, point[1]);
    return point;
}

function squaredSegmentDistance(point, start, end) {
    let x = start[0];
    let y = start[1];
    let dx = end[0] - x;
    let dy = end[1] - y;

    if (dx !== 0 || dy !== 0) {
        const t =
            ((point[0] - x) * dx + (point[1] - y) * dy) /
            (dx * dx + dy * dy);
        if (t > 1) {
            x = end[0];
            y = end[1];
        } else if (t > 0) {
            x += dx * t;
            y += dy * t;
        }
    }

    dx = point[0] - x;
    dy = point[1] - y;
    return dx * dx + dy * dy;
}

function simplifyLine(points, tolerance) {
    if (points.length <= 3) return points;

    const squareTolerance = tolerance * tolerance;
    const markers = new Uint8Array(points.length);
    const stack = [[0, points.length - 1]];
    markers[0] = 1;
    markers[points.length - 1] = 1;

    while (stack.length > 0) {
        const [first, last] = stack.pop();
        let maxDistance = squareTolerance;
        let splitIndex = 0;

        for (let index = first + 1; index < last; index += 1) {
            const distance = squaredSegmentDistance(
                points[index],
                points[first],
                points[last],
            );
            if (distance > maxDistance) {
                splitIndex = index;
                maxDistance = distance;
            }
        }

        if (splitIndex !== 0) {
            markers[splitIndex] = 1;
            stack.push([first, splitIndex], [splitIndex, last]);
        }
    }

    return points.filter((_, index) => markers[index] === 1);
}

function formatNumber(value) {
    return Number(value.toFixed(2));
}

function ringToPath(ring) {
    const projected = ring.map(project);
    const openRing =
        projected.length > 1 &&
        projected[0][0] === projected.at(-1)[0] &&
        projected[0][1] === projected.at(-1)[1]
            ? projected.slice(0, -1)
            : projected;
    const simplified = simplifyLine(openRing, SIMPLIFICATION_TOLERANCE);
    if (simplified.length < 3) return "";

    const [first, ...rest] = simplified;
    return `M${formatNumber(first[0])} ${formatNumber(first[1])}${rest
        .map((point) => `L${formatNumber(point[0])} ${formatNumber(point[1])}`)
        .join("")}Z`;
}

function geometryToPath(geometry) {
    if (geometry.type === "Polygon") {
        return geometry.coordinates.map(ringToPath).join("");
    }
    if (geometry.type === "MultiPolygon") {
        return geometry.coordinates
            .flatMap((polygon) => polygon.map(ringToPath))
            .join("");
    }
    throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

function escapeAttribute(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

const paths = geoJson.features
    .map((feature) => {
        const id = feature.properties?.shapeISO;
        const name = feature.properties?.shapeName ?? id;
        if (!id || !feature.geometry) {
            throw new Error("Every feature must have shapeISO and geometry");
        }
        return `  <path id="${escapeAttribute(id)}" data-name="${escapeAttribute(name)}" fill-rule="evenodd" d="${geometryToPath(feature.geometry)}"/>`;
    })
    .join("\n");

const extentWidth = projectedExtent.maxX - projectedExtent.minX;
const extentHeight = projectedExtent.maxY - projectedExtent.minY;
const previewPadding = Math.max(extentWidth, extentHeight) * 0.02;
const previewViewBox = [
    projectedExtent.minX - previewPadding,
    projectedExtent.minY - previewPadding,
    extentWidth + previewPadding * 2,
    extentHeight + previewPadding * 2,
]
    .map(formatNumber)
    .join(" ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${previewViewBox}">
  <title>${escapeAttribute(title)}</title>
  <g id="map">
${paths}
  </g>
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`Generated ${outputPath} with ${geoJson.features.length} features`);
