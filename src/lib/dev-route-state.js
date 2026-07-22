const pathSegments = (pathname) => pathname.split('/').filter(Boolean);

export const isMountainTagIndex = (pathname) => {
    const segments = pathSegments(pathname);
    return segments.length === 2 && segments[0] === 'yama' && segments[1] === 'tags';
};

export const isMountainTagPage = (pathname) => {
    const segments = pathSegments(pathname);
    return segments.length === 3 && segments[0] === 'yama' && segments[1] === 'tags';
};
