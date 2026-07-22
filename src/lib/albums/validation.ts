import { MdxPhotoError, extractMdxPhotos } from "./mdx-photos.ts";
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
    mdxPath: string;
    mdxBody: string;
};

export function validateAlbumInventory(input: AlbumInventoryInput): AlbumDiagnostic[] {
    const { albumSlug, manifestPath, manifest, mdxPath, mdxBody } = input;
    let references;
    try {
        references = extractMdxPhotos(mdxBody);
    } catch (error) {
        if (!(error instanceof MdxPhotoError)) throw error;
        return [{
            code: "mdx-photo-syntax",
            message: error.message,
            albumSlug,
            sourcePath: mdxPath,
            manifestPath,
            fieldPath: `Photo@${error.offset}`,
        }];
    }

    const diagnostics: AlbumDiagnostic[] = [];
    const manifestFilenames = new Set(manifest.photos.map(({ filename }) => filename));
    const firstReferenceByFilename = new Map<string, number>();

    for (const reference of references) {
        const firstOffset = firstReferenceByFilename.get(reference.filename);
        if (firstOffset !== undefined) {
            diagnostics.push({
                code: "duplicate-mdx-photo",
                message: `Duplicate MDX Photo reference ${JSON.stringify(reference.filename)}; first referenced at offset ${firstOffset}`,
                albumSlug,
                sourcePath: mdxPath,
                manifestPath,
                fieldPath: `Photo@${reference.offset}`,
            });
        } else {
            firstReferenceByFilename.set(reference.filename, reference.offset);
        }

        if (!manifestFilenames.has(reference.filename)) {
            diagnostics.push({
                code: "mdx-photo-missing-from-manifest",
                message: `MDX Photo ${JSON.stringify(reference.filename)} is missing from the Album manifest photos inventory`,
                albumSlug,
                sourcePath: mdxPath,
                manifestPath,
                fieldPath: `Photo@${reference.offset}`,
            });
        }
    }

    const referencedFilenames = new Set(firstReferenceByFilename.keys());
    const selectedLocalCover = manifest.cover.photo.kind === "local"
        ? manifest.cover.photo.filename
        : undefined;

    manifest.photos.forEach(({ filename }, index) => {
        if (!referencedFilenames.has(filename) && filename !== selectedLocalCover) {
            diagnostics.push({
                code: "manifest-photo-not-in-mdx",
                message: `Manifest photo ${JSON.stringify(filename)} is not referenced by MDX and is not the selected local cover`,
                albumSlug,
                sourcePath: manifestPath,
                manifestPath,
                fieldPath: `photos[${index}].filename`,
            });
        }
    });

    const mdxContentOrder = [...firstReferenceByFilename.keys()]
        .filter((filename) => manifestFilenames.has(filename));
    const manifestContentOrder = manifest.photos
        .map(({ filename }) => filename)
        .filter((filename) => referencedFilenames.has(filename));

    if (
        mdxContentOrder.length === manifestContentOrder.length &&
        mdxContentOrder.some((filename, index) => filename !== manifestContentOrder[index])
    ) {
        diagnostics.push({
            code: "manifest-photo-order-mismatch",
            message: `Manifest content photo order [${manifestContentOrder.join(", ")}] does not match MDX order [${mdxContentOrder.join(", ")}]`,
            albumSlug,
            sourcePath: manifestPath,
            manifestPath,
            fieldPath: "photos",
        });
    }

    return diagnostics;
}
