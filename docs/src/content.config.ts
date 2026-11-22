import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

const castName = z.enum(['asimov', 'buck', 'gil', 'lucy', 'mallory', 'pinta', 'riona', 'sam', 'val']);

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        /** One of the cast introducing the page, in a speech bubble under the title. */
        host: z.object({ who: castName, says: z.string(), side: z.enum(['left', 'right']).optional() }).optional(),
      }),
    }),
  }),
};
