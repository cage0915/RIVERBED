import { getCollection } from 'astro:content';

interface Tag {
    name: string;
    x: number;
    y: number;
}

interface PhotoWithTags {
    itemKey: string;
    caption?: string;
    tags: Tag[];
    albumTitle: string;
    albumId: string;
    folder: string;
}

// Use import.meta.glob for production-safe loading of JSON files
const tagFiles = import.meta.glob('/src/album-tags/**/*.json', { eager: true });


export async function getAllPhotosWithTags() {
    const albums = await getCollection('albums');
    const allPhotos: PhotoWithTags[] = [];

    for (const album of albums) {
        const body = album.body;
        const [folder, albumId] = album.slug.split('/');

        // Match the JSON path used in the glob
        const jsonPath = `/src/album-tags/${folder}/${albumId}.json`;
        const tagsMap = (tagFiles[jsonPath] as any)?.default || {};


        // Regex to match <Photo ... /> tags
        const photoRegex = /<Photo\s+([^>]*)\/>/g;
        let match;

        while ((match = photoRegex.exec(body)) !== null) {
            const propsStr = match[1];

            // Extract itemKey
            const itemKeyMatch = propsStr.match(/itemKey=["']([^"']+)["']/);
            const itemKey = itemKeyMatch ? itemKeyMatch[1] : null;

            // Extract caption
            const captionMatch = propsStr.match(/caption=["']([^"']*)["']/);
            const caption = captionMatch ? captionMatch[1] : undefined;

            if (itemKey) {
                allPhotos.push({
                    itemKey,
                    caption,
                    tags: tagsMap[itemKey] || [],
                    albumTitle: album.data.title,
                    albumId,
                    folder
                });
            }
        }
    }

    return allPhotos;
}

