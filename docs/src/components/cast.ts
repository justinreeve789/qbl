// The nine player avatars, who also host the docs. Pictures are copies of
// scenarios/assets/platform/{avatars,portraits}/<name>.png (the docs image builds from docs/ alone).
import type { ImageMetadata } from 'astro';
import asimov from '../assets/cast/asimov.png';
import buck from '../assets/cast/buck.png';
import gil from '../assets/cast/gil.png';
import lucy from '../assets/cast/lucy.png';
import mallory from '../assets/cast/mallory.png';
import pinta from '../assets/cast/pinta.png';
import riona from '../assets/cast/riona.png';
import sam from '../assets/cast/sam.png';
import val from '../assets/cast/val.png';
import asimovFace from '../assets/cast/portraits/asimov.png';
import buckFace from '../assets/cast/portraits/buck.png';
import gilFace from '../assets/cast/portraits/gil.png';
import lucyFace from '../assets/cast/portraits/lucy.png';
import malloryFace from '../assets/cast/portraits/mallory.png';
import pintaFace from '../assets/cast/portraits/pinta.png';
import rionaFace from '../assets/cast/portraits/riona.png';
import samFace from '../assets/cast/portraits/sam.png';
import valFace from '../assets/cast/portraits/val.png';

export type CastName = 'asimov' | 'buck' | 'gil' | 'lucy' | 'mallory' | 'pinta' | 'riona' | 'sam' | 'val';

export interface CastMember {
  name: string;
  picture: ImageMetadata;
  portrait: ImageMetadata;
  /** The way the art faces. The Host component mirrors it to face its bubble. */
  faces: 'left' | 'right';
  /** Bubble and name-tag colour. */
  color: string;
  /** What they look after in the docs (the cast line-up on the home page). */
  beat: string;
}

export const CAST: Record<CastName, CastMember> = {
  asimov: { name: 'Asimov', picture: asimov, portrait: asimovFace, faces: 'left', color: '#22b8cf', beat: 'Getting started, and the engine room for developers' },
  val: { name: 'Val', picture: val, portrait: valFace, faces: 'right', color: '#12b886', beat: 'Teaching with QuestLab, classes and reports' },
  lucy: { name: 'Lucy', picture: lucy, portrait: lucyFace, faces: 'right', color: '#e64980', beat: 'The Cloudy Pond walkthrough and mission ideas' },
  mallory: { name: 'Mallory', picture: mallory, portrait: malloryFace, faces: 'left', color: '#d6336c', beat: 'Scenes, hotspots, events and actions' },
  sam: { name: 'Sam', picture: sam, portrait: samFace, faces: 'right', color: '#7950f2', beat: 'Questions, maths, experiments and the bench' },
  pinta: { name: 'Pinta', picture: pinta, portrait: pintaFace, faces: 'right', color: '#40c057', beat: 'Characters, conversations and voices' },
  gil: { name: 'Gil', picture: gil, portrait: gilFace, faces: 'right', color: '#339af0', beat: 'Lesson plans and the library' },
  riona: { name: 'Riona', picture: riona, portrait: rionaFace, faces: 'left', color: '#ae3ec9', beat: 'The AI mission generator and the asset library' },
  buck: { name: 'Buck', picture: buck, portrait: buckFace, faces: 'left', color: '#f59f00', beat: 'Privacy, sign-in, districts and the public API' },
};

export const CAST_ORDER = Object.keys(CAST) as CastName[];
