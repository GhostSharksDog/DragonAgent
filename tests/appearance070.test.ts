import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableAccent } from '../src/renderer/Appearance';
import { appearanceValues } from '../src/shared/appearance';

const luminance = (hex: string) => {
  const m = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  assert.ok(m, `invalid color ${hex}`);
  const f = (v: number) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  return .2126 * f(parseInt(m![1], 16)) + .7152 * f(parseInt(m![2], 16)) + .0722 * f(parseInt(m![3], 16));
};

test('custom accent colors stay readable for text and primary buttons', () => {
  for (const input of ['#ffff00', '#ffffff', '#00ff00']) {
    const accent = readableAccent(input, false);
    assert.match(accent, /^#[a-f\d]{6}$/);
    assert.ok(luminance(accent) <= .53, `${input} → ${accent} 仍然过亮`);
  }
  for (const input of ['#000000', '#101010', '#0000ff']) {
    const accent = readableAccent(input, true);
    assert.ok(luminance(accent) >= .29, `${input} → ${accent} 在深色主题下过暗`);
    assert.ok(luminance(accent) <= .63, `${input} → ${accent} 在深色主题下不适合白字按钮`);
  }
  assert.equal(readableAccent('not-a-color', false), 'not-a-color');
  assert.equal(readableAccent('#7250a4', false), '#7250a4');
});

test('appearance values never expose the composer opacity and clamp ranges', () => {
  const values = appearanceValues({ output: NaN, header: 9, selection: -1, x: 200, y: -20, fontSize: 99 as any, density: 'huge' as any });
  assert.equal(values.output, .48);
  assert.equal(values.header, 1);
  assert.equal(values.selection, 0);
  assert.equal(values.x, 100);
  assert.equal(values.y, 0);
  assert.equal(values.fontSize, 15);
  assert.equal(values.density, 'standard');
  assert.equal('composer' in values, false);
});
