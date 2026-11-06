import { createAlbumCatalog } from "./catalog-core.ts";
import type { AlbumCatalog, AlbumSourceRecord } from "./catalog-core.ts";
import { parseAlbumManifest } from "./manifest-schema.ts";
import type { NormalizedAlbum } from "./types.ts";
import type { AlbumDiagnostic } from "./validation.ts";

export type JsonModule = { default: unknown };

export type AlbumSummary = Omit<NormalizedAlbum, "blocks" | "photos">;

const MANIFEST_PATH = /^\/src\/album-manifests\/(.+)\.json$/;

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

export function buildAlbumCatalogFromManifests(
    manifestModules: Record<string, JsonModule>,
): AlbumCatalog {
    const records: AlbumSourceRecord[] = Object.entries(manifestModules).map(([manifestPath, module]) => {
        const slug = MANIFEST_PATH.exec(manifestPath)?.[1];
        if (slug === undefined) throw new Error(`Unexpected Album manifest path: ${manifestPath}`);
        return { slug, manifestPath, manifest: parseManifest(module, slug, manifestPath) };
    });

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
        const { blocks: _blocks, photos: _photos, ...summary } = album;
        return cloneSummary(summary);
    });
    return () => snapshot.map(cloneSummary);
}
