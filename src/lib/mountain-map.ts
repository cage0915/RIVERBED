import mapConfig from "../map-contexts.json" with { type: "json" };

export const MAP_WORLD_SIZE = 10_000;
export const MAX_MERCATOR_LATITUDE = 85.05112878;

export type MapBounds = {
    west: number;
    south: number;
    east: number;
    north: number;
};

export type MapPoint = {
    x: number;
    y: number;
};

export type SvgViewBox = [number, number, number, number];

export type MapSource = {
    id: string;
    asset: string;
    featureIds: string[];
    extent: readonly [number, number, number, number];
    attribution: Array<{
        label: string;
        url: string;
    }>;
};

export type MapContext = {
    id: string;
    label: string;
    level: "country" | "admin1" | "region";
    source: keyof typeof MAP_SOURCES;
    bounds: MapBounds;
    protected?: boolean;
};

const TAIWAN_FEATURE_IDS = [
    "TW-CHA",
    "TW-CYI",
    "TW-CYQ",
    "TW-HSQ",
    "TW-HSZ",
    "TW-HUA",
    "TW-ILA",
    "TW-KEE",
    "TW-KHH",
    "TW-KIN",
    "TW-LIE",
    "TW-MIA",
    "TW-NAN",
    "TW-NWT",
    "TW-PEN",
    "TW-PIF",
    "TW-TAO",
    "TW-TNN",
    "TW-TPE",
    "TW-TTT",
    "TW-TXG",
    "TW-YUN",
];

const JAPAN_FEATURE_IDS = Array.from(
    { length: 47 },
    (_, index) => `JP-${String(index + 1).padStart(2, "0")}`,
);

export const MAP_SOURCES = {
    taiwan: {
        id: "taiwan",
        asset: "/maps/taiwan-outline.svg",
        featureIds: TAIWAN_FEATURE_IDS,
        extent: [8238.52, 4236.3, 153.99, 179.29],
        attribution: [
            {
                label: "geoBoundaries",
                url: "https://www.geoboundaries.org/",
            },
            {
                label: "© OpenStreetMap contributors",
                url: "https://www.openstreetmap.org/copyright",
            },
        ],
    },
    japan: {
        id: "japan",
        asset: "/maps/japan-outline.svg",
        featureIds: JAPAN_FEATURE_IDS,
        extent: [8397.57, 3559.36, 897.08, 769.44],
        attribution: [
            {
                label: "geoBoundaries",
                url: "https://www.geoboundaries.org/",
            },
            {
                label: "© OpenStreetMap contributors",
                url: "https://www.openstreetmap.org/copyright",
            },
        ],
    },
} as const satisfies Record<string, MapSource>;

export const MAP_CONTEXTS = mapConfig.contexts as Record<string, MapContext>;

export type MapContextId = string;

export function isMapContextId(value: string): value is MapContextId {
    return Object.prototype.hasOwnProperty.call(MAP_CONTEXTS, value);
}

export function projectCoordinates(
    latitude: number,
    longitude: number,
): MapPoint {
    const clampedLatitude = Math.max(
        -MAX_MERCATOR_LATITUDE,
        Math.min(MAX_MERCATOR_LATITUDE, latitude),
    );
    const latitudeRadians = (clampedLatitude * Math.PI) / 180;
    const x = ((longitude + 180) / 360) * MAP_WORLD_SIZE;
    const y =
        (1 -
            Math.log(
                Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians),
            ) /
                Math.PI) /
        2 *
        MAP_WORLD_SIZE;

    return { x, y };
}

export function unprojectCoordinates(point: MapPoint): {
    latitude: number;
    longitude: number;
} {
    const longitude = (point.x / MAP_WORLD_SIZE) * 360 - 180;
    const mercatorY = Math.PI - (2 * Math.PI * point.y) / MAP_WORLD_SIZE;
    const latitude = (Math.atan(Math.sinh(mercatorY)) * 180) / Math.PI;

    return { latitude, longitude };
}

export function isValidMapBounds(bounds: unknown): bounds is MapBounds {
    if (!bounds || typeof bounds !== "object") return false;
    const candidate = bounds as Partial<MapBounds>;
    return (
        Number.isFinite(candidate.west) &&
        Number.isFinite(candidate.south) &&
        Number.isFinite(candidate.east) &&
        Number.isFinite(candidate.north) &&
        candidate.west! < candidate.east! &&
        candidate.south! < candidate.north! &&
        candidate.west! >= -180 &&
        candidate.east! <= 180 &&
        candidate.south! >= -90 &&
        candidate.north! <= 90
    );
}

export function boundsToViewBox(bounds: MapBounds): SvgViewBox {
    if (!isValidMapBounds(bounds)) {
        throw new Error("Invalid map bounds");
    }

    const northWest = projectCoordinates(bounds.north, bounds.west);
    const southEast = projectCoordinates(bounds.south, bounds.east);

    return [
        northWest.x,
        northWest.y,
        southEast.x - northWest.x,
        southEast.y - northWest.y,
    ];
}

export function viewBoxToBounds(viewBox: SvgViewBox): MapBounds {
    const [x, y, width, height] = viewBox;
    if (
        ![x, y, width, height].every(Number.isFinite) ||
        width <= 0 ||
        height <= 0
    ) {
        throw new Error("Invalid SVG viewBox");
    }

    const northWest = unprojectCoordinates({ x, y });
    const southEast = unprojectCoordinates({ x: x + width, y: y + height });
    const bounds = {
        west: northWest.longitude,
        south: southEast.latitude,
        east: southEast.longitude,
        north: northWest.latitude,
    };

    if (
        !isValidMapBounds(bounds)
    ) {
        throw new Error("SVG viewBox falls outside valid geographic bounds");
    }

    return bounds;
}

export function formatViewBox(bounds: MapBounds): string {
    return boundsToViewBox(bounds)
        .map((value) => Number(value.toFixed(4)))
        .join(" ");
}

export function isPointInsideBounds(
    latitude: number,
    longitude: number,
    bounds: MapBounds,
): boolean {
    return (
        latitude >= bounds.south &&
        latitude <= bounds.north &&
        longitude >= bounds.west &&
        longitude <= bounds.east
    );
}

export function constrainMapViewBox(
    viewBox: SvgViewBox,
    initialViewBox: SvgViewBox,
    sourceViewBox: SvgViewBox,
): SvgViewBox {
    let [x, y, width] = viewBox;
    const aspectRatio = initialViewBox[2] / initialViewBox[3];
    const minimumScale = 1 / 32;
    const maximumScale =
        Math.max(
            sourceViewBox[2] / initialViewBox[2],
            sourceViewBox[3] / initialViewBox[3],
        ) * 1.1;
    const requestedScale = width / initialViewBox[2];
    const scale = Math.min(
        maximumScale,
        Math.max(minimumScale, requestedScale),
    );
    width = initialViewBox[2] * scale;
    const height = width / aspectRatio;

    const padding = Math.max(sourceViewBox[2], sourceViewBox[3]) * 0.04;
    const minimumX = sourceViewBox[0] - padding;
    const minimumY = sourceViewBox[1] - padding;
    const maximumX = sourceViewBox[0] + sourceViewBox[2] + padding;
    const maximumY = sourceViewBox[1] + sourceViewBox[3] + padding;

    x = width >= maximumX - minimumX
        ? minimumX + (maximumX - minimumX - width) / 2
        : Math.min(maximumX - width, Math.max(minimumX, x));
    y = height >= maximumY - minimumY
        ? minimumY + (maximumY - minimumY - height) / 2
        : Math.min(maximumY - height, Math.max(minimumY, y));

    return [x, y, width, height];
}

export function zoomMapViewBoxAt(
    currentViewBox: SvgViewBox,
    factor: number,
    point: MapPoint,
    initialViewBox: SvgViewBox,
    sourceViewBox: SvgViewBox,
): SvgViewBox {
    const [x, y, width, height] = currentViewBox;
    const nextWidth = width * factor;
    const nextHeight = height * factor;
    const nextX = point.x - (point.x - x) * factor;
    const nextY = point.y - (point.y - y) * factor;

    return constrainMapViewBox(
        [nextX, nextY, nextWidth, nextHeight],
        initialViewBox,
        sourceViewBox,
    );
}
