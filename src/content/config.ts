import { defineCollection, z } from 'astro:content';

// Album metadata lives in the slug-paired manifest; MDX stores layout and prose.
const albums = defineCollection({
    type: 'content',
    schema: z.object({}).strict(),
});

export const collections = { albums };
