import { albumBlockPhotos } from "./blocks.ts";
import type { AlbumManifest } from "./types.ts";

export type AlbumDiagnostic = {
    code: string;
    message: string;
    albumSlug: string;
    sourcePath: string;
    manifestPath: string;
    fieldPath?: string;
};

export type AlbumInventoryInput = {
    albumSlug: string;
    manifestPath: string;
    manifest: AlbumManifest;
};

export function validateAlbumInventory(input: AlbumInventoryInput): AlbumDiagnostic[] {
    const { albumSlug, manifestPath, manifest } = input;
    const diagnostic = (code: string, message: string, fieldPath: string): AlbumDiagnostic => ({
        code,
        message,
        albumSlug,
        sourcePath: manifestPath,
        manifestPath,
        fieldPath,
    });

    const diagnostics: AlbumDiagnostic[] = [];
    const manifestFilenames = new Set(manifest.photos.map(({ filename }) => filename));
    const placedFilenames = new Set<string>();

    for (const filename of albumBlockPhotos(manifest.blocks)) {
        if (placedFilenames.has(filename)) {
            diagnostics.push(diagnostic(
                "duplicate-block-photo",
                `Photo ${JSON.stringify(filename)} is placed more than once in blocks`,
                "blocks",
            ));
        }
        placedFilenames.add(filename);

        if (!manifestFilenames.has(filename)) {
            diagnostics.push(diagnostic(
                "block-photo-missing-from-manifest",
                `Block photo ${JSON.stringify(filename)} is missing from the Album manifest photos inventory`,
                "blocks",
            ));
        }
    }

    const selectedLocalCover = manifest.cover.photo.kind === "local"
        ? manifest.cover.photo.filename
        : undefined;

    manifest.photos.forEach(({ filename }, index) => {
        if (!placedFilenames.has(filename) && filename !== selectedLocalCover) {
            diagnostics.push(diagnostic(
                "manifest-photo-not-in-blocks",
                `Manifest photo ${JSON.stringify(filename)} is not placed by blocks and is not the selected local cover`,
                `photos[${index}].filename`,
            ));
        }
    });

    const blockContentOrder = [...placedFilenames].filter((filename) => manifestFilenames.has(filename));
    const manifestContentOrder = manifest.photos
        .map(({ filename }) => filename)
        .filter((filename) => placedFilenames.has(filename));

    if (
        blockContentOrder.length === manifestContentOrder.length &&
        blockContentOrder.some((filename, index) => filename !== manifestContentOrder[index])
    ) {
        diagnostics.push(diagnostic(
            "manifest-photo-order-mismatch",
            `Manifest content photo order [${manifestContentOrder.join(", ")}] does not match block order [${blockContentOrder.join(", ")}]`,
            "photos",
        ));
    }

    return diagnostics;
}
