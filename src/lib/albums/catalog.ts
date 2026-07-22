import { getCollection } from "astro:content";

import type { AlbumCatalog } from "./catalog-core.ts";
import {
    buildAlbumCatalogFromSources,
    createAlbumSummaryReader,
} from "./catalog-source.ts";
import type { AlbumSummary, JsonModule } from "./catalog-source.ts";
import type { NormalizedAlbum, TaggedPhoto } from "./types.ts";

export type { AlbumSummary } from "./catalog-source.ts";

const manifestModules = import.meta.glob(
    "/src/album-manifests/**/*.json",
    { eager: true },
) as Record<string, JsonModule>;

type CatalogState = {
    catalog: AlbumCatalog;
    readSummaries: () => AlbumSummary[];
};

let catalogStatePromise: Promise<CatalogState> | undefined;

async function loadCatalogState(): Promise<CatalogState> {
    const entries = await getCollection("albums");
    const catalog = buildAlbumCatalogFromSources(
        entries.map((entry) => ({
            slug: entry.slug,
            mdxPath: `/src/content/albums/${entry.slug}.mdx`,
            mdxBody: entry.body,
        })),
        manifestModules,
    );
    return { catalog, readSummaries: createAlbumSummaryReader(catalog) };
}

function getCatalogState(): Promise<CatalogState> {
    catalogStatePromise ??= loadCatalogState();
    return catalogStatePromise;
}

export async function getAlbumCatalog(): Promise<AlbumCatalog> {
    return (await getCatalogState()).catalog;
}

export async function getAlbumSummaries(): Promise<AlbumSummary[]> {
    return (await getCatalogState()).readSummaries();
}

export async function getAlbumBySlug(slug: string): Promise<NormalizedAlbum | null> {
    return (await getAlbumCatalog()).getAlbum(slug);
}

export async function getTaggedPhotos(tagName: string): Promise<TaggedPhoto[]> {
    return (await getAlbumCatalog()).getTaggedPhotos(tagName);
}
