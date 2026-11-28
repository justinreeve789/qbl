import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

const castName = z.enum(['asimov', 'buck', 'gil', 'lucy', 'mallory', 'pinta', 'riona', 'sam', 'val']);

/**
 * What a mission blueprint page (src/content/docs/blueprints/) says about itself. The header, the
 * standards table, the overview grid and the standards index are all drawn from this
 * (src/components/blueprints/).
 */
const blueprint = z.object({
  /** Its place in the set, 1 to 24. */
  number: z.number().int().positive(),
  band: z.enum(['K-2', '3-5', '6-8', '8-12']),
  /** As a teacher would say it: "Grade 1", "Grades 6-8". */
  grades: z.string(),
  /** Subject tags, the main one first (it gives the page its colour). */
  subjects: z.array(z.enum(['science', 'maths', 'english', 'history', 'economics', 'engineering'])).min(1),
  /** The subjects in words: "science and maths". */
  about: z.string(),
  minutes: z.number().int().positive(),
  /** "2 to 4" */
  players: z.string(),
  /** One emoji for the header and the card. */
  icon: z.string(),
  /** What students do, in a line (the card on the overview page). */
  mechanic: z.string(),
  /** The advantages it leans on: letters from ADVANTAGES in src/components/blueprints/lib.ts. */
  edge: z.array(z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).min(1),
  standards: z.array(z.object({
    /** The publisher's code: "3.NF.A.1", "MS-LS4-4", "D2.Eco.5.3-5". */
    code: z.string(),
    /** When only part of a standard is meant: "phases". */
    part: z.string().optional(),
    /** Taught by the optional harder objective. */
    bonus: z.boolean().optional(),
    asks: z.string(),
    evidence: z.string(),
  })).min(1),
  /** Other curricula it fits, by topic. */
  alsoFits: z.string().optional(),
  /** What to choose on the Generate page, or pass to qbl:generate. */
  settings: z.object({
    grade: z.string(),
    subject: z.string(),
    frameworks: z.array(z.string()),
    players: z.string(),
    opening: z.enum(['action', 'balanced', 'story']),
    focus: z.enum(['play', 'balanced', 'rigor']),
    freedom: z.enum(['guided', 'balanced', 'open']),
  }),
});

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        /** One of the cast introducing the page, in a speech bubble under the title. */
        host: z.object({ who: castName, says: z.string(), side: z.enum(['left', 'right']).optional() }).optional(),
        /** A mission blueprint's own details. */
        blueprint: blueprint.optional(),
      }),
    }),
  }),
};
