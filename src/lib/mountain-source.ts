import {
    parseMountainArray,
    type Mountain,
} from "./mountain-schema.ts";

export function parseMountainRegionSource(
    input: unknown,
    sourcePath: string,
    contextIds: ReadonlySet<string>,
): Mountain[] {
    try {
        return parseMountainArray(input, contextIds);
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Invalid Mountain source ${sourcePath}: ${message}`, {
            cause,
        });
    }
}
