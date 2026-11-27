import { BUILD_LOOK, LABEL_COLORS, type BuildPiece } from '@qbl/shared';
import { ApiError, type Api, type StudentBuild } from '../api';
import { config } from '../config';
import { clear, confirmDelete, h, help, toast } from '../dom';

type Filter = 'pending' | 'approved' | 'hidden';
const FILTERS: Array<[Filter, string]> = [['pending', 'Waiting'], ['approved', 'Approved'], ['hidden', 'Hidden']];

const fail = (err: unknown, fallback: string) => toast(err instanceof ApiError || err instanceof Error ? err.message : fallback, 'error');

/** When, in a few words: "today 14:05", "3 Dec". */
function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? `today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/**
 * A build drawn where it is in its scene: the scene's main picture, and each piece placed and
 * sized as the game draws it (BUILD_LOOK), in percentages of the scene so it scales to the card.
 */
export function buildPreview(build: StudentBuild): HTMLElement {
  const p = build.preview;
  const width = p.width || 1;
  const height = p.height || 1;
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const box = h('div', { class: 'build-preview', style: `aspect-ratio: ${width} / ${height}` });
  if (p.background_url) box.append(h('img', { class: 'build-preview-bg', src: p.background_url, alt: '' }));
  let spots = 0;
  for (const shown of build.pieces) {
    // A hotspot is drawn as what it looks like, marked and numbered so the list below can say what it opens.
    const spot = shown.kind === 'hotspot' ? ++spots : 0;
    const look = shown.kind === 'hotspot' ? shown.look ?? 'none' : null;
    const piece: BuildPiece = look ? { ...shown, kind: look === 'none' ? 'hotspot' : look === 'label' ? 'label' : look } : shown;
    const scale = piece.scale ?? 1;
    const place = `left: ${pct(piece.x, width)}; top: ${pct(piece.y, height)}; transform: translate(-50%, -50%) rotate(${piece.angle ?? 0}deg);`;
    if (spot) box.append(h('span', { class: 'build-preview-spot', style: `left: ${pct(piece.x, width)}; top: ${pct(piece.y, height)};`, title: `Hotspot ${spot}` }, String(spot)));
    if (piece.kind === 'hotspot') {
      const side = pct(BUILD_LOOK.hotspotBox * scale, width);
      box.append(h('span', { class: 'build-preview-box', style: `${place} width: ${side}; aspect-ratio: 1;` }));
      continue;
    }
    if (piece.kind === 'label') {
      const color = piece.color ?? LABEL_COLORS[0]!;
      box.append(h('span', { class: 'build-preview-label', style: `${place} color: ${color}; font-size: ${((BUILD_LOOK.labelSize * scale) / width) * 100}cqw;` }, piece.text ?? ''));
      continue;
    }
    const pic = piece.kind === 'sticker' ? p.media[String(piece.media_id)] : p.pictures[String(piece.upload_id)];
    if (!pic?.url) continue;
    const w = piece.kind === 'sticker'
      ? (pic.width || 64) * scale * (p.zoom ?? 1)
      : (pic.width * BUILD_LOOK.pictureBox * scale) / Math.max(1, pic.width, pic.height);
    box.append(h('img', { class: 'build-preview-piece', src: pic.url, alt: piece.kind === 'picture' ? 'A picture the student uploaded' : '', style: `${place} width: ${pct(w, width)};` }));
  }
  return box;
}

/**
 * What each of a build's hotspots opens, numbered as the preview marks them, for the teacher to read:
 * what it has the narrator say (with the recording to listen to, once made), its words and its picture.
 */
export function hotspotList(build: StudentBuild): HTMLElement | null {
  const spots = build.pieces.filter((p) => p.kind === 'hotspot');
  if (!spots.length) return null;
  const p = build.preview;
  return h('ol', { class: 'build-hotspots' }, ...spots.map((s) => {
    const o = s.opens ?? {};
    const pic = o.media_id != null ? p.media[String(o.media_id)] : o.upload_id != null ? p.pictures[String(o.upload_id)] : null;
    const voice = o.say ? build.voices?.[s.id] : undefined;
    const recorded = voice && voice.speech.line === o.say;
    const said = o.say
      ? h('div', { class: 'build-hotspot-say' },
        h('span', null, `🗣️ The narrator says: ${o.say}`),
        recorded
          ? h('audio', { controls: '', preload: 'none', src: voice.url, 'aria-label': 'What the narrator says' })
          : h('span', { class: 'muted' }, 'Not recorded yet: the browser’s voice reads it.'))
      : null;
    return h('li', null,
      pic?.url ? h('img', { src: pic.url, alt: o.upload_id != null ? 'A picture the student uploaded' : '' }) : null,
      h('div', { class: 'build-hotspot-opens' },
        said,
        o.text ? h('span', null, o.text) : pic ? h('span', { class: 'muted' }, 'Only a picture.') : null));
  }));
}

/** The game, in the build's instance and scene, opening the build for its teacher to change. */
export function changeInGameUrl(build: StudentBuild): string {
  const query = new URLSearchParams({ group: build.group ?? 'public', scene: String(build.scene_id), edit_build: String(build.id) });
  return new URL(`${config.gameUrl}${encodeURIComponent(build.scenario.code)}?${query}`, window.location.href).href;
}

/**
 * Students' builds: what they added to scenes that let them build, for their teacher to approve
 * before classmates see it (or to hide again). On the Classes page.
 */
export function studentBuildsCard(api: Api): HTMLElement {
  let filter: Filter = 'pending';
  let builds: StudentBuild[] = [];
  let waiting = 0;
  const list = h('div', { class: 'build-list' }, h('p', { class: 'muted' }, 'Loading…'));
  const tabs = h('div', { class: 'build-tabs', role: 'tablist' });
  const card = h(
    'div',
    { class: 'card', 'data-card': 'builds' },
    h('h2', null, '🛠️ Student builds ', help('In scenes whose author lets students build, students add pieces, words, their own pictures and hotspots. A build waits here until you approve it; until then only its maker sees it. Hiding takes an approved build down again. Change in the game opens the build in its scene, where you can move, change or remove anything in it. Starting a student’s game again removes what they built.')),
    tabs,
    list,
  );

  const drawTabs = () => clear(tabs, ...FILTERS.map(([key, label]) => h('button', {
    type: 'button', role: 'tab', class: key === filter ? 'current' : '', 'aria-selected': String(key === filter), 'data-builds-filter': key,
    onclick: () => { filter = key; void load(); },
  }, key === 'pending' && waiting ? `${label} (${waiting})` : label)));

  const act = async (b: StudentBuild, status: 'approved' | 'hidden') => {
    try {
      await api.reviewBuild(b.id, status);
      toast(status === 'approved' ? `${b.student.name}’s build is shown now.` : `${b.student.name}’s build is hidden.`);
      await load();
    } catch (err) {
      fail(err, 'Could not change that build.');
    }
  };

  const draw = () => {
    drawTabs();
    if (!builds.length) {
      clear(list, h('p', { class: 'empty' }, filter === 'pending' ? 'Nothing is waiting for you.' : filter === 'approved' ? 'No approved builds.' : 'No hidden builds.'));
      return;
    }
    clear(list, ...builds.map((b) => h(
      'article',
      { class: 'build-item', 'data-build': b.id },
      buildPreview(b),
      hotspotList(b),
      h('div', { class: 'build-about' },
        h('strong', null, b.student.name),
        h('span', { class: 'muted' }, ` · ${b.scenario.title} · ${b.preview.scene} · ${b.where}`),
        h('span', { class: 'muted' }, ` · ${b.pieces.length} ${b.pieces.length === 1 ? 'thing' : 'things'} · ${when(b.updated_at)}`)),
      h('div', { class: 'build-actions' },
        b.status !== 'approved' ? h('button', { type: 'button', class: 'primary', onclick: () => void act(b, 'approved') }, 'Approve') : null,
        b.status !== 'hidden' ? h('button', { type: 'button', onclick: () => void act(b, 'hidden') }, b.status === 'pending' ? 'Not now' : 'Hide') : null,
        b.group ? h('a', { class: 'button', href: changeInGameUrl(b), target: '_blank', rel: 'noopener', 'data-build-change': '' }, '✏️ Change in the game') : null,
        h('button', {
          type: 'button', class: 'danger',
          onclick: async () => {
            if (!confirmDelete(`${b.student.name}’s build`)) return;
            try {
              await api.deleteBuild(b.id);
              await load();
            } catch (err) {
              fail(err, 'Could not delete that build.');
            }
          },
        }, 'Delete')),
    )));
  };

  const load = async () => {
    try {
      const [shown, pending] = await Promise.all([api.studentBuilds(filter), filter === 'pending' ? null : api.studentBuilds('pending')]);
      builds = shown;
      waiting = (pending ?? shown).length;
      draw();
    } catch (err) {
      // An API without building (an older server) shows nothing rather than an error.
      if (err instanceof ApiError && err.status === 404) {
        card.hidden = true;
        return;
      }
      clear(list, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load the builds.'));
    }
  };
  void load();
  return card;
}
