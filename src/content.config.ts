import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Album metadata lives in the slug-paired manifest; MDX stores layout and prose.
const albums = defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/albums' }),
    schema: z.object({}).strict(),
});

export const collections = { albums };
