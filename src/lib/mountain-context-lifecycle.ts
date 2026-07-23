import type { MountainWithRegion } from "./mountains.ts";

export function getMountainContextReferences(
    mountains: readonly MountainWithRegion[],
    contextId: string,
): string[] {
    return mountains
        .filter((mountain) => mountain.location?.mapContext === contextId)
        .map((mountain) => mountain.name)
        .sort((left, right) => left.localeCompare(right, "zh-Hant"));
}
