import type { CharacterPicture } from '@qbl/shared';

/**
 * A character's picture on the page: an <img> for a still picture or an animated PNG (which a
 * browser plays by itself), or one frame of a sprite sheet. The frame is cut out with the
 * sheet as a background, so the box takes the frame's shape once the sheet has loaded.
 */
export function pictureNode(picture: CharacterPicture, className: string): HTMLElement {
  const url = picture.url ?? '';
  const sheet = picture.sheet && (picture.sheet.columns > 1 || picture.sheet.rows > 1) ? picture.sheet : null;
  let node: HTMLElement;
  if (sheet) {
    node = document.createElement('span');
    const frame = picture.frame ?? 0;
    const col = frame % sheet.columns;
    const row = Math.floor(frame / sheet.columns);
    node.style.backgroundImage = `url("${url}")`;
    node.style.backgroundSize = `${sheet.columns * 100}% ${sheet.rows * 100}%`;
    node.style.backgroundPosition = `${sheet.columns > 1 ? (col / (sheet.columns - 1)) * 100 : 0}% ${sheet.rows > 1 ? (row / (sheet.rows - 1)) * 100 : 0}%`;
    node.dataset.frame = String(frame);
    const probe = new Image();
    probe.onload = () => {
      const w = probe.naturalWidth / sheet.columns;
      const h = probe.naturalHeight / sheet.rows;
      if (w > 0 && h > 0) node.style.aspectRatio = `${w} / ${h}`;
    };
    probe.src = url;
  } else {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    node = img;
  }
  node.className = className;
  if (picture.flip) node.style.transform = 'scaleX(-1)';
  return node;
}
