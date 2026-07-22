import { createAlbumCatalog } from "./catalog-core.ts";
import type { AlbumCatalog, AlbumSourceRecord } from "./catalog-core.ts";
import { parseAlbumManifest } from "./manifest-schema.ts";
import type { NormalizedAlbum } from "./types.ts";
import type { AlbumDiagnostic } from "./validation.ts";

export type AlbumContentSource = {
    slug: string;
    mdxPath: string;
    mdxBody: string;
};

export type JsonModule = { default: unknown };

export type AlbumSummary = Omit<NormalizedAlbum, "photos">;

function manifestPathForSlug(slug: string): string {
    return `/src/album-manifests/${slug}.json`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function parseManifest(module: JsonModule, slug: string, manifestPath: string) {
    try {
        return parseAlbumManifest(module.default, slug);
    } catch (cause) {
        throw new Error(
            `Invalid Album manifest ${manifestPath}: ${errorMessage(cause)}`,
            { cause },
        );
    }
}

function diagnosticLocation(diagnostic: AlbumDiagnostic): string {
    const parts = [
        `sourcePath=${diagnostic.sourcePath}`,
        `manifestPath=${diagnostic.manifestPath}`,
    ];
    if (diagnostic.fieldPath !== undefined) {
        parts.push(`fieldPath=${diagnostic.fieldPath}`);
    }
    return parts.join(" ");
}

export function buildAlbumCatalogFromSources(
    entries: AlbumContentSource[],
    manifestModules: Record<string, JsonModule>,
): AlbumCatalog {
    const expectedManifestPaths = new Set<string>();
    const records: AlbumSourceRecord[] = entries.map((entry) => {
        const manifestPath = manifestPathForSlug(entry.slug);
        expectedManifestPaths.add(manifestPath);
        const manifestModule = manifestModules[manifestPath];
        if (manifestModule === undefined) {
            throw new Error(`Missing Album manifest for ${entry.slug}: ${manifestPath}`);
        }
        return {
            ...entry,
            manifestPath,
            manifest: parseManifest(manifestModule, entry.slug, manifestPath),
        };
    });

    const orphanManifestPaths = Object.keys(manifestModules)
        .filter((manifestPath) => !expectedManifestPaths.has(manifestPath))
        .sort();
    if (orphanManifestPaths.length > 0) {
        throw new Error(`Album manifests without paired MDX: ${orphanManifestPaths.join(", ")}`);
    }

    const catalog = createAlbumCatalog(records);
    if (catalog.diagnostics.length > 0) {
        const details = catalog.diagnostics.map((diagnostic) =>
            `[${diagnostic.code}] ${diagnostic.albumSlug} ${diagnosticLocation(diagnostic)}: ${diagnostic.message}`
        );
        throw new Error(`Album catalog validation failed:\n${details.join("\n")}`);
    }
    return catalog;
}

function cloneSummary(summary: AlbumSummary): AlbumSummary {
    return {
        ...summary,
        cover: {
            ...summary.cover,
            photo: { ...summary.cover.photo },
            offset: { ...summary.cover.offset },
        },
    };
}

export function createAlbumSummaryReader(
    catalog: Pick<AlbumCatalog, "getAlbums">,
): () => AlbumSummary[] {
    const snapshot = catalog.getAlbums().map((album) => {
        const { photos: _photos, ...summary } = album;
        return cloneSummary(summary);
    });
    return () => snapshot.map(cloneSummary);
}
