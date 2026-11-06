import type { AlbumBlock } from "./types.ts";

/** Every photo filename placed by the blocks, in page order. */
export function albumBlockPhotos(blocks: readonly AlbumBlock[]): string[] {
    return blocks.flatMap((block) => block.type === "Text"
        ? []
        : block.photos.flatMap((item) => typeof item === "string" ? [item] : item.column));
}

/** Returns blocks with every photo filename passed through `rename`. */
export function renameAlbumBlockPhotos(
    blocks: readonly AlbumBlock[],
    rename: (filename: string) => string,
): AlbumBlock[] {
    return blocks.map((block) => {
        switch (block.type) {
            case "Text":
                return { ...block };
            case "Row":
                return {
                    ...block,
                    photos: block.photos.map((item) =>
                        typeof item === "string" ? rename(item) : { column: item.column.map(rename) }
                    ),
                };
            default:
                return { ...block, photos: block.photos.map(rename) };
        }
    });
}
