export const FOLDER_METADATA = {
    'dalin': { title: '大林', order: 1 },
    'yama': { title: '山', footer: '見る・撮る・歩く', order: 2 },
    'k': { title: 'K', footer: 'So Much Water So Close to Home', order: 3 },
    'y': { title: 'y', footer: 'Y aller', order: 4 },
    'palette': { title: 'P', footer: 'P for Palette', order: 5 },
} as const;

type FolderSlug = keyof typeof FOLDER_METADATA;

export const getFolderTitle = (slug: string) => {
    return FOLDER_METADATA[slug as FolderSlug]?.title || slug.toUpperCase();
};

export const getFolderOrder = (slug: string) => {
    return FOLDER_METADATA[slug as FolderSlug]?.order ?? 99;
};

export const getFolderFooter = (slug: string) => {
    return (FOLDER_METADATA[slug as FolderSlug] as any)?.footer;
};
export const R2_DOMAIN = 'https://photos.cage0915.com';

export const getImageUrl = (itemKey: string) => {
    return import.meta.env.DEV
        ? `/r2/${itemKey}`
        : `${R2_DOMAIN}/${itemKey}`;
};
