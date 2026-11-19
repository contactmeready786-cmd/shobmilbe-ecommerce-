// 📸 ছবি দিয়ে খুঁজুন: a photo's views are compared with every product picture; each product counts with its best
// picture and best view, best first, and "sure" only when the first is clearly ahead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank, verdict } from '../lib/admin/photofind';

const EMB = 384;
const vec = (seed: number, noise = 0, base?: Int8Array) => {
  const v = new Int8Array(EMB);
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  for (let i = 0; i < EMB; i++) v[i] = Math.max(-127, Math.min(127, Math.round((base ? base[i] : rnd() * 200) + noise * rnd() * 200)));
  return v;
};
const pic = (media: number, product: number, e: Int8Array) => {
  let n = 0; for (let i = 0; i < EMB; i++) n += e[i] * e[i];
  return { media, product, e, n: Math.sqrt(n) };
};

test('the product whose picture looks like the photo comes first, with its best picture', () => {
  const a = vec(1), b = vec(2), c = vec(3);
  const photo = vec(9, 0.3, a); // the same product, another photo
  const list = rank([vec(7), photo], [pic(10, 1, b), pic(11, 2, a), pic(12, 2, c), pic(13, 3, c)]);
  assert.equal(list[0].product, 2);
  assert.equal(list[0].media, 11);
  assert.ok(list[0].score > 0.8);
  assert.equal(list.length, 3); // one line per product
  assert.ok(list[1].score < 0.5);
});

test('how sure: clearly ahead → sure; close or low → not', () => {
  assert.equal(verdict([{ score: 0.9 }, { score: 0.89 }]), 'maybe'); // two products with the same picture: the owner picks
  assert.equal(verdict([{ score: 0.78 }, { score: 0.6 }]), 'sure');
  assert.equal(verdict([{ score: 0.78 }, { score: 0.76 }]), 'maybe'); // two look alike: the owner picks
  assert.equal(verdict([{ score: 0.55 }]), 'maybe');
  assert.equal(verdict([{ score: 0.3 }]), 'none');
  assert.equal(verdict([]), 'none');
});
