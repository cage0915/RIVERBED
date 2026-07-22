/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
    readonly PEAKFINDER_ENABLED?: string;
    readonly R2_ACCOUNT_ID?: string;
    readonly R2_ACCESS_KEY_ID?: string;
    readonly R2_SECRET_ACCESS_KEY?: string;
    readonly R2_BUCKET?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare namespace App {
    interface Locals {
        albumPhotoContext?: {
            sourceAlbumSlug: import("./lib/albums/types").AlbumSlug;
            photos: ReadonlyMap<
                string,
                import("./lib/albums/types").ResolvedAlbumPhoto
            >;
        };
    }
}
