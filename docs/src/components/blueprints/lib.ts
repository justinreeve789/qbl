// Mission blueprints: the pages under /docs/blueprints/ describe themselves in their frontmatter
// (`blueprint:`), and the components in this folder draw the header, the standards table, the grid
// on the overview page and the standards index from it. Nothing here is repeated by hand.
import { getCollection, type CollectionEntry } from 'astro:content';

export type Blueprint = NonNullable<CollectionEntry<'docs'>['data']['blueprint']>;
export type BlueprintEntry = CollectionEntry<'docs'> & { data: { blueprint: Blueprint } };
export type Subject = Blueprint['subjects'][number];
export type Band = Blueprint['band'];
export type Edge = Blueprint['edge'][number];

/** Subject tags, with the colour each one has everywhere (the diagram palette in qbl.css). */
export const SUBJECTS: Record<Subject, { label: string; color: string }> = {
  science: { label: 'Science', color: '#2fb344' },
  maths: { label: 'Maths', color: '#339af0' },
  english: { label: 'English', color: '#e64980' },
  history: { label: 'History', color: '#f59f00' },
  economics: { label: 'Economics', color: '#15aabf' },
  engineering: { label: 'Engineering', color: '#8b5cf6' },
};
export const SUBJECT_ORDER = Object.keys(SUBJECTS) as Subject[];

export const BANDS: Record<Band, string> = {
  'K-2': 'Grades K to 2',
  '3-5': 'Grades 3 to 5',
  '6-8': 'Grades 6 to 8',
  '8-12': 'Grades 8 to 12',
};

/** What a simulated world can do that a classroom cannot. Each blueprint names the ones it leans on. */
export const ADVANTAGES: Record<Edge, { name: string; icon: string; means: string; features: string }> = {
  A: { name: 'Compressed time', icon: '⏩', means: 'A day, a season, ten generations or a million years pass in minutes.', features: 'Living sky, a scene per era, cutscenes, instruments' },
  B: { name: 'Unreachable places', icon: '🧭', means: 'Canyon floors, four climates, other continents, the past, other planets.', features: 'Scene kinds, portals, weather, underwater light' },
  C: { name: 'Free failure', icon: '🔁', means: 'A bridge collapses, a titration overshoots, a sample misleads, and the retry costs nothing.', features: 'The bench, instruments with Start again' },
  D: { name: 'Changed rules of nature', icon: '🎚️', means: 'Turn gravity down, remove the decomposers, set the tilt of the Earth to zero.', features: 'Instrument switches and sliders' },
  E: { name: 'Made visible', icon: '👁️', means: 'Stress in a beam, a fraction as a distance walked, a ratio as a colour.', features: 'Wide scenes, meters, lights with conditions' },
  F: { name: 'Real interdependence', icon: '🤝', means: 'One teammate holds the clue another needs, in a different scene.', features: 'Shared variables, team tasks, clues spread across scenes' },
  G: { name: 'Evidence and making', icon: '🧱', means: 'You see first tries, tries and time for each learning goal, and students leave a build behind.', features: 'Reports, student building, narrated hotspots' },
};
export const EDGE_ORDER = Object.keys(ADVANTAGES) as Edge[];

/** Every blueprint page, in its numbered order. */
export async function blueprints(): Promise<BlueprintEntry[]> {
  const all = (await getCollection('docs', (e) => Boolean(e.data.blueprint))) as BlueprintEntry[];
  return all.sort((a, b) => a.data.blueprint.number - b.data.blueprint.number);
}

/** The address of a docs page from its id. */
export const href = (id: string, hash = '') => `/docs/${id}/${hash ? `#${hash}` : ''}`;

/** `--tone` and `--tone2` for a blueprint: its first subject's colour, and its second's. */
export function tones(b: Blueprint): string {
  const [first, second = first] = b.subjects;
  return `--tone: ${SUBJECTS[first!].color}; --tone2: ${SUBJECTS[second!].color}`;
}
