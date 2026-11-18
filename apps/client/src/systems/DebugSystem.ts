import * as Phaser from 'phaser';
import type { Point } from '@qbl/shared';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';

/** Outlines walkable areas, spawn points, hotspot areas and obstacles. Enabled with ?debug. */
export class DebugSystem implements SceneSystem {
  private graphics?: Phaser.GameObjects.Graphics;

  constructor(private rt: SceneRuntime) {}

  create() {
    if (!this.rt.ctx.options.debug) return;
    const { def, size, scene } = this.rt;
    const g = (this.graphics = scene.add.graphics().setDepth(Depth.debug));
    const poly = (points: Point[], color: number) => {
      g.lineStyle(3, color, 0.9);
      g.strokePoints(points.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true);
    };
    for (const p of def.walkable_areas ?? []) poly(p, 0x33ff88);
    for (const p of def.blocked_areas ?? []) poly(p, 0xff3355);
    g.fillStyle(0x33aaff, 0.9);
    for (const s of def.spawn_points ?? []) g.fillCircle(s.position_x, s.position_y, 8);
    g.lineStyle(2, 0xff66ff, 0.8);
    for (const h of def.hotspots ?? []) {
      const r = h.radius ?? -1;
      if (r <= 0) continue;
      // A null coordinate spans that whole axis, so the hotspot is a band (typically a scene edge).
      if (h.position_x != null && h.position_y != null) g.strokeCircle(h.position_x, h.position_y, r);
      else if (h.position_x != null) g.strokeRect(h.position_x - r, 0, r * 2, size.height);
      else if (h.position_y != null) g.strokeRect(0, h.position_y - r, size.width, r * 2);
    }
    g.lineStyle(2, 0xff3355, 0.8);
    for (const o of this.rt.walk().obstacles) g.strokeCircle(o.x, o.y, o.radius);
    // Shadow spots: the edge of each patch of shade.
    g.lineStyle(2, 0x9aa0ff, 0.8);
    for (const s of def.shadow_spots ?? []) g.strokeEllipse(s.x, s.y, s.radius * 2, (s.radius_y ?? s.radius) * 2);
  }

  destroy() {
    this.graphics?.destroy();
  }
}
