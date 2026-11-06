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

type BlockSpacing = { blockMargin?: string };
type BlockCaption = { caption?: string; captionPosition?: string };

export type TextBlock = BlockSpacing & {
    type: "Text";
    align?: "left" | "center" | "right";
    size?: "caption" | "title";
    text: string;
};

/** A Row item is one photo, or a Column of photos stacked at a shared width. */
export type RowItem = string | { column: string[] };

export type RowBlock = BlockSpacing & BlockCaption & {
    type: "Row";
    photos: RowItem[];
};

export type PhotoCarouselBlock = BlockSpacing & BlockCaption & {
    type: "PhotoCarousel";
    initialSlide?: number;
    peekPercent?: number;
    photos: string[];
};

export type PhotoPanoramaBlock = BlockSpacing & BlockCaption & {
    type: "PhotoPanorama";
    initialSlide?: number;
    initialView?: "carousel" | "panorama";
    panoramaSlices?: number;
    photos: string[];
};

export type AlbumBlock = TextBlock | RowBlock | PhotoCarouselBlock | PhotoPanoramaBlock;

export type AlbumManifest = {
    schemaVersion: 2;
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
    blocks: AlbumBlock[];
    photos: Array<{
        filename: string;
        width?: number;
        height?: number;
        caption?: string;
        tags: PhotoTag[];
    }>;
};

export type ResolvedAlbumPhoto = {
    sourceAlbumSlug: AlbumSlug;
    sourceAlbumTitle: string;
    filename: string;
    assetKey: string;
    width?: number;
    height?: number;
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
