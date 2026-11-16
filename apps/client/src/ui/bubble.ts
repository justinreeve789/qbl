/** Where the speaker is on the page, in viewport pixels. `x` is their middle. */
export interface BubbleAnchor {
  x: number;
  top: number;
  bottom: number;
  width?: number;
}

export interface BubblePlacement {
  left: number;
  top: number;
  /** Which side of the speaker the bubble is on. */
  side: 'above' | 'below' | 'left' | 'right';
  /** Where the tail meets the bubble, measured along the edge that faces the speaker. */
  tail: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Place a speech bubble so that all of it is on screen. It goes above the speaker when there
 * is room; below when the speaker is near the top; and to the right or left when there is room
 * neither above nor below. Sideways it slides along to stay inside the margins, and the tail
 * keeps pointing at the speaker.
 */
export function placeBubble(
  anchor: BubbleAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
  gap = 14,
): BubblePlacement {
  const { width: w, height: h } = size;
  const horizontal = (top: number, side: 'above' | 'below'): BubblePlacement => {
    const left = clamp(anchor.x - w / 2, margin, viewport.width - w - margin);
    return { left, top, side, tail: clamp(anchor.x - left, 18, w - 18) };
  };
  if (anchor.top - gap - h >= margin) return horizontal(anchor.top - gap - h, 'above');
  if (anchor.bottom + gap + h <= viewport.height - margin) return horizontal(anchor.bottom + gap, 'below');

  const half = (anchor.width ?? 0) / 2;
  const middle = (anchor.top + anchor.bottom) / 2;
  const top = clamp(middle - h / 2, margin, viewport.height - h - margin);
  const tail = clamp(middle - top, 18, h - 18);
  const roomRight = viewport.width - margin - (anchor.x + half + gap);
  const roomLeft = anchor.x - half - gap - margin;
  if (roomRight >= w || roomRight >= roomLeft) return { left: clamp(anchor.x + half + gap, margin, viewport.width - w - margin), top, side: 'right', tail };
  return { left: clamp(anchor.x - half - gap - w, margin, viewport.width - w - margin), top, side: 'left', tail };
}
