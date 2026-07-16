export type MountainCoordinates = {
    latitude: number;
    longitude: number;
};

const DIRECTIONAL_COORDINATES = /^\s*(\d+(?:\.\d+)?)\s*°\s*([NS])\s*,\s*(\d+(?:\.\d+)?)\s*°\s*([EW])\s*$/i;

export function parseDirectionalCoordinates(value: string): MountainCoordinates | null {
    const match = value.match(DIRECTIONAL_COORDINATES);
    if (!match) return null;

    const latitudeMagnitude = Number(match[1]);
    const longitudeMagnitude = Number(match[3]);
    if (
        !Number.isFinite(latitudeMagnitude) || latitudeMagnitude > 90 ||
        !Number.isFinite(longitudeMagnitude) || longitudeMagnitude > 180
    ) {
        return null;
    }

    return {
        latitude: match[2].toUpperCase() === "S" ? -latitudeMagnitude : latitudeMagnitude,
        longitude: match[4].toUpperCase() === "W" ? -longitudeMagnitude : longitudeMagnitude,
    };
}
