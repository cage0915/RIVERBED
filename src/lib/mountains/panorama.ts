export type PeakFinderViewpoint = {
    latitude: number;
    longitude: number;
    mountainName: string;
    elevation?: number | null;
};

export function buildPeakFinderEmbedUrl({
    latitude,
    longitude,
    mountainName,
    elevation,
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
    return url.toString();
}
