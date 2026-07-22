type StaticPath<P extends Record<string, string>> = {
    params: P;
};

export function folderPathParams(
    albumSlugs: string[],
    configuredFolders: string[] = [],
): StaticPath<{ folder: string }>[] {
    const folders = new Set(configuredFolders);

    for (const slug of albumSlugs) {
        const [folder] = slug.split("/");
        if (folder) folders.add(folder);
    }

    return [...folders]
        .sort((a, b) => a.localeCompare(b))
        .map((folder) => ({ params: { folder } }));
}

export function albumPathParams(
    albumSlugs: string[],
): StaticPath<{ folder: string; album: string }>[] {
    return albumSlugs.map((slug) => {
        const parts = slug.split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
            throw new Error(`Invalid album slug: ${slug}`);
        }

        return {
            params: { folder: parts[0], album: parts[1] },
        };
    });
}

export function tagPathParams(
    mountainNames: string[],
    photoTagNames: string[],
): StaticPath<{ tag: string }>[] {
    return [...new Set([...mountainNames, ...photoTagNames])]
        .sort()
        .map((tag) => ({ params: { tag } }));
}
