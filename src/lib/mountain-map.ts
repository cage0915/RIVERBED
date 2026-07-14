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

export type MapView = {
    id: string;
    label: string;
    level: "country" | "admin1" | "region";
    source: keyof typeof MAP_SOURCES;
    bounds: MapBounds;
    visibleFeatures?: string[];
};

export type MapContext = {
    id: string;
    defaultView: keyof typeof MAP_VIEWS;
    views: Array<keyof typeof MAP_VIEWS>;
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

const TAIWAN_MAIN_ISLAND_FEATURE_IDS = TAIWAN_FEATURE_IDS.filter(
    (id) => !["TW-KIN", "TW-LIE", "TW-PEN"].includes(id),
);

const JAPAN_FEATURE_IDS = Array.from(
    { length: 47 },
    (_, index) => `JP-${String(index + 1).padStart(2, "0")}`,
);

const HONSHU_FEATURE_IDS = Array.from(
    { length: 34 },
    (_, index) => `JP-${String(index + 2).padStart(2, "0")}`,
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

export const MAP_VIEWS = {
    "tw-dabajian-area": {
        id: "tw-dabajian-area",
        label: "大霸群峰",
        level: "region",
        source: "taiwan",
        bounds: { west: 120.9, south: 24.15, east: 121.48, north: 24.72 },
        visibleFeatures: ["TW-HSQ", "TW-MIA", "TW-TXG"],
    },
    "tw-hsinchu-miaoli": {
        id: "tw-hsinchu-miaoli",
        label: "新竹・苗栗",
        level: "region",
        source: "taiwan",
        bounds: { west: 120.52, south: 24.25, east: 121.48, north: 25.02 },
        visibleFeatures: ["TW-HSQ", "TW-MIA"],
    },
    "tw-main-island": {
        id: "tw-main-island",
        label: "台灣本島",
        level: "country",
        source: "taiwan",
        bounds: { west: 119.9, south: 21.7, east: 122.2, north: 25.5 },
        visibleFeatures: TAIWAN_MAIN_ISLAND_FEATURE_IDS,
    },
    "jp-northern-alps": {
        id: "jp-northern-alps",
        label: "北阿爾卑斯",
        level: "region",
        source: "japan",
        bounds: { west: 136.95, south: 35.7, east: 138.4, north: 37.25 },
        visibleFeatures: ["JP-15", "JP-16", "JP-20", "JP-21"],
    },
    "jp-nagano": {
        id: "jp-nagano",
        label: "長野縣",
        level: "admin1",
        source: "japan",
        bounds: { west: 137.25, south: 35.15, east: 138.85, north: 37.1 },
        visibleFeatures: ["JP-20"],
    },
    "jp-honshu": {
        id: "jp-honshu",
        label: "日本本州",
        level: "country",
        source: "japan",
        bounds: { west: 129.5, south: 32.5, east: 142.2, north: 41.7 },
        visibleFeatures: HONSHU_FEATURE_IDS,
    },
} as const satisfies Record<string, Omit<MapView, "source"> & { source: keyof typeof MAP_SOURCES }>;

export const MAP_CONTEXTS = {
    "tw-dabajian": {
        id: "tw-dabajian",
        defaultView: "tw-dabajian-area",
        views: ["tw-dabajian-area", "tw-hsinchu-miaoli", "tw-main-island"],
    },
    "jp-northern-alps": {
        id: "jp-northern-alps",
        defaultView: "jp-northern-alps",
        views: ["jp-northern-alps", "jp-nagano", "jp-honshu"],
    },
} as const satisfies Record<string, MapContext>;

export type MapContextId = keyof typeof MAP_CONTEXTS;

export function isMapContextId(value: string): value is MapContextId {
    return value in MAP_CONTEXTS;
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

export function boundsToViewBox(bounds: MapBounds): [number, number, number, number] {
    if (
        bounds.west >= bounds.east ||
        bounds.south >= bounds.north ||
        bounds.west < -180 ||
        bounds.east > 180 ||
        bounds.south < -90 ||
        bounds.north > 90
    ) {
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
