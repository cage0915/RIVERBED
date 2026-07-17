export const FOLDER_METADATA = {
    'dalin': { title: '大林', order: 1, cols: 3 },
    'yama': { title: '山', footer: '見る・撮る・歩く', order: 2, cols: 3 },
    'k': { title: 'K', footer: 'So Much Water So Close to Home', order: 3, cols: 3 },
    'y': { title: 'y', footer: 'Y aller', order: 4, cols: 4 },
    'palette': { title: 'Palette', footer: 'P for Palette', order: 5, cols: 3 },
} as const;

type FolderSlug = keyof typeof FOLDER_METADATA;

export const getFolderTitle = (slug: string) => {
    return FOLDER_METADATA[slug as FolderSlug]?.title || slug;
};

export const getFolderOrder = (slug: string) => {
    return FOLDER_METADATA[slug as FolderSlug]?.order ?? 99;
};

export const getFolderFooter = (slug: string) => {
    return (FOLDER_METADATA[slug as FolderSlug] as any)?.footer;
};

export const getFolderCols = (slug: string) => {
    return (FOLDER_METADATA[slug as FolderSlug] as any)?.cols ?? 3;
};
export const R2_DOMAIN = 'https://photos.cage0915.com';

export const getImageUrl = (itemKey: string) => {
    return import.meta.env.DEV
        ? `/r2/${itemKey}`
        : `${R2_DOMAIN}/${itemKey}`;
};

export const getThumbnailUrl = (itemKey: string, width = 480) => {
    if (import.meta.env.DEV) return `/r2/${itemKey}`;

    const safeWidth = Math.max(1, Math.round(width));
    return `${R2_DOMAIN}/cdn-cgi/image/width=${safeWidth},quality=75,format=auto,onerror=redirect/${itemKey}`;
};
