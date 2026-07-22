export type AlbumSlug = `${string}/${string}`;

export type PhotoTag = {
    name: string;
    x: number;
    y: number;
};

export type LocalCoverPhoto = {
    kind: "local";
    filename: string;
};

export type ExternalCoverPhoto = {
    kind: "external";
    assetKey: string;
};

export type AlbumManifest = {
    schemaVersion: 1;
    title: string;
    info?: string;
    publishedAt?: string;
    order: number;
    gap?: string;
    cover: {
        photo: LocalCoverPhoto | ExternalCoverPhoto;
        zoom: number;
        offset: { x: number; y: number };
    };
    photos: Array<{
        filename: string;
        caption?: string;
        tags: PhotoTag[];
    }>;
};

export type ResolvedAlbumPhoto = {
    sourceAlbumSlug: AlbumSlug;
    sourceAlbumTitle: string;
    filename: string;
    assetKey: string;
    caption?: string;
    tags: PhotoTag[];
    isContent: boolean;
};

export type NormalizedAlbum = Omit<AlbumManifest, "cover" | "photos"> & {
    slug: AlbumSlug;
    folder: string;
    albumId: string;
    cover: AlbumManifest["cover"] & { assetKey: string };
    photos: ResolvedAlbumPhoto[];
};

export type TaggedPhoto = ResolvedAlbumPhoto & { isContent: true };
