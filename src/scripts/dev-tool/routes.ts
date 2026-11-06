export const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);

// Extract albumSlug from URL (e.g. /yama/2026-shinano-omachi)
export const getAlbumSlug = () => {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2) {
        return `${pathParts[0]}/${pathParts[1]}`;
    }
    return "";
};

export const getFolderSlug = () => {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 1) {
        return pathParts[0];
    }
    return "";
};

export const isFolderPage = () => {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    return pathParts.length === 1;
};

export const isRootPage = () =>
    window.location.pathname.split('/').filter(Boolean).length === 0;
