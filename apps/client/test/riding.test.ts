import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutBelow } from '../src/entities/Avatar';

/** Just enough of a Phaser picture for `cutBelow`: a 100 px tall frame drawn from its feet. */
function picture(y: number, scale: number) {
  const o = {
    x: 0, y, scaleY: scale, originY: 1, isCropped: false,
    frame: { width: 60, height: 100 },
    crop: null as null | [number, number, number, number],
    setCrop(...args: number[]) {
      if (args.length === 0) {
        this.isCropped = false;
        this.crop = null;
      } else {
        this.isCropped = true;
        this.crop = args as [number, number, number, number];
      }
      return this;
    },
  };
  return o;
}
type Pic = Parameters<typeof cutBelow>[0];

test('a rider is drawn only above the line, in the picture’s own pixels', () => {
  // Feet at 500, twice the size: the picture spans 300 to 500 on the screen.
  const avatar = picture(500, 2);
  cutBelow(avatar as unknown as Pic, 420);
  assert.deepEqual(avatar.crop, [0, 0, 60, 60], '120 screen pixels are 60 of the picture’s');
});

test('no line, or a line below the feet, draws the whole picture again', () => {
  const avatar = picture(500, 1);
  cutBelow(avatar as unknown as Pic, 450);
  assert.ok(avatar.isCropped);
  cutBelow(avatar as unknown as Pic, Infinity);
  assert.equal(avatar.isCropped, false, 'getting off the vehicle brings the legs back');
  cutBelow(avatar as unknown as Pic, 520);
  assert.equal(avatar.isCropped, false);
});

test('a line above the head hides the whole picture', () => {
  const avatar = picture(500, 1);
  cutBelow(avatar as unknown as Pic, 200);
  assert.deepEqual(avatar.crop, [0, 0, 60, 0]);
});
