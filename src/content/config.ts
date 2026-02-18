import { defineCollection, z } from 'astro:content';

// Albums collection (MDX) - stores album content with photos
const albums = defineCollection({
    type: 'content',
    schema: z.object({
        title: z.string(),
        coverKey: z.string(), // R2 key for cover image
        order: z.number().default(0), // display order within folder
    }),
});

export const collections = { albums };

