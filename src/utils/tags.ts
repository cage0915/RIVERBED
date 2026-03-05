
import { getCollection } from 'astro:content';
import fs from 'fs';
import path from 'path';

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
        const [folder, albumId] = album.slug.split('/');

        // Load tags from the JSON sidecar file
        const jsonPath = path.resolve(
            process.cwd(),
            'src/album-tags',
            folder,
            `${albumId}.json`
        );
        let tagsMap: Record<string, Tag[]> = {};
        try {
            if (fs.existsSync(jsonPath)) {
                tagsMap = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            }
        } catch (e) {
            console.error(`Failed to load tags JSON for ${album.id}:`, e);
        }

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

export async function getAllUniqueTags() {
    const photos = await getAllPhotosWithTags();
    const tagNames = new Set<string>();
    photos.forEach(photo => {
        photo.tags.forEach(tag => tagNames.add(tag.name));
    });
    return Array.from(tagNames);
}
