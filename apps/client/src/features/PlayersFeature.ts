import { parseIds, rankFor, resolveMediaUrl, type PlayerProfile, type PlayerRec } from '@qbl/shared';
import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';
import type { PlayerRow, ProfileView } from '../ui/UiPort';

/** How often the list of players is brought up to date. */
const REFRESH_MS = 500;

/** The scene a player is in, by the name players would know it by. */
function sceneName(ctx: GameContext, sceneId: number): string | undefined {
  const scene = ctx.index.scene(sceneId);
  if (!scene) return undefined;
  const name = scene.subtitle || scene.shortname;
  return name ? name.replace(/[-_]+/g, ' ') : undefined;
}

/** Everyone in the scenario with this player, as the players list shows them: this player first, then their team, then the rest. */
export function playerRows(ctx: GameContext): PlayerRow[] {
  const { connection } = ctx;
  const me = connection.me;
  const rows: PlayerRow[] = [];
  connection.state.players.forEach((p, id) => {
    const mine = id === connection.sessionId;
    const teammate = (p.team ?? '') === (me?.team ?? '');
    rows.push({
      id, name: p.name, me: mine, teammate,
      // Only this player's own team has a name here; other teams are simply "another team".
      team: teammate ? ctx.team.name : 'Another team',
      here: !mine && ctx.sees(p),
      where: mine ? undefined : sceneName(ctx, p.scene_id),
      connected: p.connected,
    });
  });
  const order = (r: PlayerRow) => (r.me ? 0 : r.teammate ? 1 : 2);
  return rows.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

/**
 * What a profile card shows for a player. `rec` is what the room knows (name, avatar, what
 * they wear right now); `profile` is what the backend adds (stars, XP, rank, badges), when
 * there is a backend to ask and the player has an account.
 */
export function profileView(ctx: GameContext, rec: PlayerRec, profile: PlayerProfile | null, loading: boolean): ProfileView {
  const media = ctx.index.media.get(profile?.avatar_media_id ?? rec.avatar) ?? ctx.index.media.get(rec.avatar);
  const worn: ProfileView['worn'] = [];
  // What they have on now, as the room shows it; failing that, what their account says they wear.
  for (const id of rec.look ? parseIds(rec.look) : (profile?.look ?? [])) {
    const item = ctx.rewards.items.get(id);
    if (!item || (item.kind !== 'wearable' && item.kind !== 'pet')) continue;
    const picture = item.media_id != null ? ctx.index.media.get(item.media_id) : undefined;
    const url = item.image_url ?? (picture ? resolveMediaUrl(ctx.scenario, picture) : null);
    if (url) worn.push({ name: item.name, url, kind: item.kind, slot: item.slot });
  }
  const mine = rec.user_id === ctx.connection.me?.user_id;
  const sameTeam = (rec.team ?? '') === (ctx.connection.me?.team ?? '');
  return {
    name: profile?.name ?? rec.name,
    loading,
    guest: rec.role === 'guest',
    team: sameTeam ? ctx.team.name : undefined,
    rank: profile?.rank ?? (mine ? ctx.rewards.progress?.rank : undefined),
    stars: profile?.stars,
    xp: profile?.xp,
    nextRankXp: profile ? (profile.next_rank_xp ?? rankFor(profile.xp).next_rank_xp) : undefined,
    badges: profile?.badges ?? [],
    avatar: { url: media ? resolveMediaUrl(ctx.scenario, media) : null, sheet: media?.sheet ? { columns: media.sheet.columns, rows: media.sheet.rows } : undefined },
    worn,
  };
}

/**
 * Who else is playing, and their profiles. The list is everyone in the scenario with this
 * player, wherever they are; clicking a name there, or another player's avatar in the scene,
 * opens that player's profile: their avatar as it is dressed, rank, stars, XP and badges.
 */
export class PlayersFeature implements GameFeature {
  /** Bring the list up to date now. It also does so by itself, twice a second. */
  refresh: () => void = () => {};

  start(ctx: GameContext): () => void {
    const { ui, connection } = ctx;
    const canMessage = connection.welcome.private_messages === true;
    const message = (id: string) => {
      const p = connection.state.players.get(id);
      if (p) ui.openMessages(id, p.name);
    };

    const profile = (id: string) => {
      const rec = connection.state.players.get(id);
      if (!rec) return;
      const on = canMessage && id !== connection.sessionId ? { message: () => message(id) } : {};
      const mine = id === connection.sessionId;
      const ask = rec.role !== 'guest' && ctx.fetchProfile != null;
      const card = ui.profile(profileView(ctx, rec, null, ask), on);
      if (!ask) return;
      void ctx.fetchProfile!(rec.user_id)
        .catch(() => null)
        .then((found) => {
          // No answer (a preview, a backend without profiles): show what the room knows, and for this player their own totals.
          const p = ctx.rewards.progress;
          const own: PlayerProfile | null = mine && p ? { user_id: rec.user_id, name: rec.name, look: p.equipped, stars: p.stars, xp: p.xp, rank: p.rank, next_rank_xp: p.next_rank_xp, badges: p.badges ?? [] } : null;
          const latest = connection.state.players.get(id) ?? rec;
          card.update(profileView(ctx, latest, found ?? own, false));
        });
    };
    ctx.showProfile = profile;

    let shown = '';
    const draw = () => {
      const rows = playerRows(ctx);
      const key = JSON.stringify(rows);
      if (key === shown) return;
      shown = key;
      ui.players(rows, canMessage ? { profile, message } : { profile });
    };
    draw();
    this.refresh = draw;
    const timer = setInterval(draw, REFRESH_MS);
    return () => {
      clearInterval(timer);
      ctx.showProfile = null;
    };
  }
}
