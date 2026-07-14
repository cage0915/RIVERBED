export type PeakFinderPanorama = {
    provider: "peakfinder";
    azimuth?: number;
    altitude?: number;
    fieldOfView?: number;
};

export type PeakFinderViewpoint = {
    latitude: number;
    longitude: number;
    mountainName: string;
    elevation?: number | null;
    panorama: PeakFinderPanorama;
};

function appendNumberInRange(
    params: URLSearchParams,
    key: string,
    value: number | undefined,
    minimum: number,
    maximum: number,
) {
    if (
        value !== undefined &&
        Number.isFinite(value) &&
        value >= minimum &&
        value <= maximum
    ) {
        params.set(key, String(value));
    }
}

export function buildPeakFinderEmbedUrl({
    latitude,
    longitude,
    mountainName,
    elevation,
    panorama,
}: PeakFinderViewpoint): string {
    if (
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
    ) {
        throw new Error("Invalid PeakFinder viewpoint coordinates");
    }

    const url = new URL("https://www.peakfinder.com/embed/");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lng", String(longitude));
    url.searchParams.set("name", mountainName);

    if (elevation !== null && elevation !== undefined && Number.isFinite(elevation)) {
        url.searchParams.set("ele", String(Math.round(elevation)));
    }

    appendNumberInRange(url.searchParams, "azi", panorama.azimuth, 0, 360);
    appendNumberInRange(url.searchParams, "alt", panorama.altitude, -25, 25);
    appendNumberInRange(url.searchParams, "fov", panorama.fieldOfView, 8, 90);

    return url.toString();
}
