
import { getCollection } from 'astro:content';

export interface Tag {
    name: string;
    x: number;
    y: number;
}

export interface PhotoWithTags {
    itemKey: string;
    caption?: string;
    tags: Tag[];
    albumTitle: string;
    albumId: string;
    folder: string;
}

export async function getAllPhotosWithTags() {
    const albums = await getCollection('albums');
    const allPhotos: PhotoWithTags[] = [];

    for (const album of albums) {
        const body = album.body;
        const folder = album.data.folder;
        // Regex to match <Photo ... /> tags
        // Handle both double and single quotes for attributes, and capture the whole tag
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

            // Extract tags
            // This is the tricky part since it's a JS array
            const tagsMatch = propsStr.match(/tags={(\[[\s\S]*?\])}/);
            let tags: Tag[] = [];

            if (itemKey && tagsMatch) {
                try {
                    const tagsStr = tagsMatch[1];
                    // Very basic JS-like to JSON converter for simple objects
                    // 1. Double quote keys
                    // 2. Replace single quotes with double quotes
                    // 3. Remove trailing commas
                    let jsonStr = tagsStr
                        .replace(/(\w+):/g, '"$1":')
                        .replace(/'/g, '"')
                        .replace(/,\s*\]/g, ']')
                        .replace(/,\s*\}/g, '}');

                    tags = JSON.parse(jsonStr);
                } catch (e) {
                    console.error(`Failed to parse tags in ${album.id} for ${itemKey}:`, e);
                }
            }

            if (itemKey) {
                allPhotos.push({
                    itemKey,
                    caption,
                    tags,
                    albumTitle: album.data.title,
                    albumId: album.id,
                    folder
                });
            }
        }
    }

    return allPhotos;
}

export async function getAllUniqueTags() {
    const photos = await getAllPhotosWithTags();
    const tagNames = new Set<string>();
    photos.forEach(photo => {
        photo.tags.forEach(tag => tagNames.add(tag.name));
    });
    return Array.from(tagNames);
}
