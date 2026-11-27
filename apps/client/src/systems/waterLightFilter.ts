import * as Phaser from 'phaser';
import { RIPPLES_ON_FIGURE_FRAG } from '@qbl/shared';

/** The Phaser render node that draws rippling light on a figure's picture. */
export const NODE = 'QblWaterOnFigure';

/** What a figure filter needs from its light, read again every frame. */
export interface FigureLight {
  time: number;
  area: { x: number; y: number; width: number; height: number; corners: unknown[] | null };
  corners: Float32Array;
  size: number;
  tilt: number;
  oval: boolean;
  rgb: [number, number, number];
  /** The strength on figures now: brightness × figures × how far it has faded in. */
  level: number;
}

/** A filter on one figure for one light. */
export interface FigureFilter {
  active: boolean;
  /** Something lying on the floor (1) rather than standing up (0). */
  flat: boolean;
}

type Picture = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

interface Made {
  make(object: Picture, light: FigureLight): FigureFilter;
}

const made = new WeakMap<Phaser.Renderer.WebGL.WebGLRenderer, Made>();

/**
 * The filter that lights a figure with the rippling light of one water light (shared
 * RIPPLES_ON_FIGURE_FRAG), for this game's renderer. Phaser's classes are only reached here, when the
 * game draws with WebGL, so the tests' Phaser (which has none) never needs them.
 */
export function figureFilters(renderer: Phaser.Renderer.WebGL.WebGLRenderer): Made {
  let m = made.get(renderer);
  if (m) return m;

  class Controller extends Phaser.Filters.Controller {
    flat = false;
    constructor(camera: Phaser.Cameras.Scene2D.Camera, readonly object: Picture, readonly light: FigureLight) {
      super(camera, NODE);
    }
  }

  class Node extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
    constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
      super(NODE, manager, undefined, RIPPLES_ON_FIGURE_FRAG);
    }

    override setupUniforms(controller: Controller) {
      const pm = this.programManager;
      const { object: o, light: l } = controller;
      const b = o.getBounds();
      pm.setUniform('uTime', l.time);
      pm.setUniform('uBox', [l.area.width, l.area.height]);
      pm.setUniform('uSize', l.size);
      pm.setUniform('uShape', l.tilt);
      pm.setUniform('uOval', l.oval ? 1 : 0);
      pm.setUniform('uColor', [...l.rgb, l.level]);
      pm.setUniform('uPoly[0]', l.corners);
      pm.setUniform('uCorners', l.area.corners?.length ?? 0);
      pm.setUniform('uArea', [l.area.x, l.area.y]);
      pm.setUniform('uRect', [b.x, b.y, b.width, b.height]);
      pm.setUniform('uFeet', b.bottom);
      pm.setUniform('uFlat', controller.flat ? 1 : 0);
      pm.setUniform('uFlipX', o.flipX ? 1 : 0);
    }
  }

  if (!renderer.renderNodes.hasNode(NODE)) renderer.renderNodes.addNodeConstructor(NODE, Node);
  m = {
    make(object, light) {
      if (!object.filters) object.enableFilters();
      const c = new Controller(object.filterCamera!, object, light);
      object.filters!.internal.add(c);
      return c;
    },
  };
  made.set(renderer, m);
  return m;
}
