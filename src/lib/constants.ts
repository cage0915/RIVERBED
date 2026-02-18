export const FOLDER_METADATA = {
    'dalin': { title: '大林', order: 1 },
    'yama': { title: '山', order: 2 },
    'k': { title: 'K', order: 3 },
    'les-lieux': { title: 'LES LIEUX', order: 4 },
    'par-avion': { title: 'PAR AVION', order: 5 },
} as const;

export type FolderSlug = keyof typeof FOLDER_METADATA;

export const getFolderTitle = (slug: string) => {
    return FOLDER_METADATA[slug as FolderSlug]?.title || slug.toUpperCase();
};

export const getFolderOrder = (slug: string) => {
    return FOLDER_METADATA[slug as FolderSlug]?.order ?? 99;
};
