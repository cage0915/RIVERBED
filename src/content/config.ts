import { defineCollection, z } from 'astro:content';

// Folders collection (JSON) - stores folder metadata
const folders = defineCollection({
    type: 'data',
    schema: z.object({
        title: z.string(),
        homeCols: z.number().default(3), // columns on home page
        albumCols: z.number().default(3), // columns on album list page
        featuredAlbum: z.string().optional(), // slug of featured album
        order: z.number().default(0), // display order
    }),
});

// Albums collection (MDX) - stores album content with photos
const albums = defineCollection({
    type: 'content',
    schema: z.object({
        title: z.string(),
        coverKey: z.string(), // R2 key for cover image
        order: z.number().default(0), // display order within folder
        folder: z.string(), // parent folder slug
    }),
});

export const collections = { folders, albums };

