// 🎤 Voice & calls (owner, 2026-11-23): only real sound files are kept, whatever the browser claims they are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioKind, decode, VoiceError } from '../lib/models/voice';

const pad = (head: number[] | string, n = 2000) => {
  const h = typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head);
  return Buffer.concat([h, Buffer.alloc(n)]);
};

test('voice: sound files are told by their first bytes', () => {
  assert.equal(audioKind(pad([0x1a, 0x45, 0xdf, 0xa3])), 'audio/webm');
  assert.equal(audioKind(pad('OggS')), 'audio/ogg');
  assert.equal(audioKind(pad('\0\0\0\x18ftypM4A ')), 'audio/mp4');
  assert.equal(audioKind(pad('RIFF\0\0\0\0WAVE')), 'audio/wav');
  assert.equal(audioKind(pad('#!AMR\n')), 'audio/amr');
  assert.equal(audioKind(pad('ID3\x03')), 'audio/mpeg');
  assert.equal(audioKind(pad('<html><script>')), null);
  assert.equal(audioKind(pad([0x89, 0x50, 0x4e, 0x47])), null); // a PNG is not a recording
});

test('voice: data URLs are checked for size and kind', () => {
  const webm = pad([0x1a, 0x45, 0xdf, 0xa3]).toString('base64');
  assert.equal(decode(`data:audio/webm;codecs=opus;base64,${webm}`, 1e6).mime, 'audio/webm');
  assert.throws(() => decode(`data:audio/webm;base64,${webm}`, 100), VoiceError); // too big
  assert.throws(() => decode('data:audio/webm;base64,AAAA', 1e6), VoiceError); // too small
  assert.throws(() => decode(`data:audio/webm;base64,${pad('<svg onload=x>').toString('base64')}`, 1e6), VoiceError); // not sound
  assert.throws(() => decode('javascript:alert(1)', 1e6), VoiceError);
});
