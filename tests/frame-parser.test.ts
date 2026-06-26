import { describe, expect, it } from 'vitest';
import { FrameParseError, parseGeminiFrameStream } from '../src/transform/frame-parser.js';

function wrbFrame(fullText: string): string {
  // StreamGenerate format: [null, ["c_id","r_id"], null, null, [[candidate, [text_parts]]]]
  const payload = JSON.stringify([null, ['c_id', 'r_id'], null, null, [['rc_id', [fullText]]]]);
  return JSON.stringify(['wrb.fr', null, payload]);
}

const fixtureStream = [
  ")]}'",
  '123',
  JSON.stringify(['di', 1388]),
  wrbFrame('Hel'),
  wrbFrame('Hello'),
  JSON.stringify(['af.httprm', 1]),
  JSON.stringify(['e', 7, null]),
  '',
].join('\n');

function collectText(chunkSize: number): string {
  return parseGeminiFrameStream(fixtureStream, chunkSize)
    .filter((event) => event.type === 'delta')
    .map((event) => event.text)
    .join('');
}

describe('GeminiFrameParser', () => {
  it('extracts identical text across chunk boundaries', () => {
    const expected = collectText(fixtureStream.length);
    for (const size of [1, 2, 5, 10, 100, 200]) {
      expect(collectText(size)).toBe(expected);
    }
    expect(expected).toBe('Hello');
  });

  it('ignores non-wrb response frames safely', () => {
    const events = parseGeminiFrameStream([JSON.stringify(['di', 1]), JSON.stringify(['af.httprm', 2]), ''].join('\n'), 1);

    expect(events).toEqual([]);
  });

  it('reports controlled parser errors for malformed JSON', () => {
    expect(() => parseGeminiFrameStream('not-json\n')).toThrow(FrameParseError);
  });

  it('extracts text from StreamGenerate candidate format', () => {
    // Real StreamGenerate: [null, ["c_id","r_id"], null, null, [[candidate, [text_parts]]]]
    const payload = JSON.stringify([null, ['c_id', 'r_id'], null, null, [['rc_id', ['Hello world']]]]);
    const frames = [
      ")]}'",
      '42',
      JSON.stringify(['wrb.fr', null, payload]),
      '',
    ].join('\n');

    const events = parseGeminiFrameStream(frames);
    const delta = events.filter((event) => event.type === 'delta');

    expect(delta).toHaveLength(1);
    expect(delta[0].text).toBe('Hello world');
    expect(delta[0].fullText).toBe('Hello world');
  });

  it('rejects short metadata strings in favor of longer candidate text', () => {
    // Ensure conversation IDs ("c_xxx" being 20 chars) don't beat "Hello" (5 chars)
    const payload = JSON.stringify([
      null, ['c_5d7e6da7217923ea', 'r_88798db14c2d9b3d'],
      null, null,
      [['rc_53871db2c3968b28', ['Hello'], null, null, null, null, null, null, [1], 'en']],
    ]);
    const frames = [
      ")]}'",
      '42',
      JSON.stringify(['wrb.fr', null, payload]),
      '',
    ].join('\n');

    const events = parseGeminiFrameStream(frames);
    const deltas = events.filter((event) => event.type === 'delta');

    expect(deltas).toHaveLength(1);
    expect(deltas[0].text).toBe('Hello');
  });

  it('extracts text from nested [[wrb.fr,...]] batch wrapper format', () => {
    // Real StreamGenerate response wraps frames in an extra array: [["wrb.fr", null, payload]]
    const payload = JSON.stringify([null, ['c_id', 'r_id'], null, null, [['rc_id', ['nested batch']]]]);
    const frames = [
      ")]}'",
      '42',
      JSON.stringify([['wrb.fr', null, payload]]),
      '',
    ].join('\n');

    const events = parseGeminiFrameStream(frames);
    const deltas = events.filter((event) => event.type === 'delta');

    expect(deltas).toHaveLength(1);
    expect(deltas[0].text).toBe('nested batch');
  });

  it('strips encrypted context appended by Gemini using conversation ID', () => {
    // Gemini appends c_<conv_hex><base64>c_<conv_hex> to response text.
    // convId = "c_a9ae8c61a13c9db3" → convHex = "a9ae8c61a13c9db3" → strips "c_a9ae8c61a13c9db3..." suffix
    const payload = JSON.stringify([
      null, ['c_a9ae8c61a13c9db3', 'r_88798db14c2d9b3d'],
      null, null,
      [['rc_id', ['Helloc_a9ae8c61a13c9db3AwAAAAAAAAAQwBHO-LzoF6L9DAwh8Bkc_a9ae8c61a13c9db3']]],
    ]);
    const frames = [
      ")]}'",
      '42',
      JSON.stringify(['wrb.fr', null, payload]),
      '',
    ].join('\n');

    const events = parseGeminiFrameStream(frames);
    const deltas = events.filter((event) => event.type === 'delta');

    expect(deltas).toHaveLength(1);
    expect(deltas[0].text).toBe('Hello');
  });

  it('maps known upstream error sequence to error event', () => {
    const events = parseGeminiFrameStream(`${JSON.stringify(['wrb.fr', null, JSON.stringify([[5, 2, 0, 1, 0]])])}\n`);

    expect(events).toEqual([{ type: 'error', code: '1037', message: 'Gemini Web quota or upstream error' }]);
  });

  it('skips metadata array frames that leak encrypted context data', () => {
    // Real frames like [null, ["c_..."], {...}, null] (length 4) carry metadata
    // but no candidate text. Without the length<5 guard they fall into
    // findLongestString and emit garbled context data.
    const payload4 = JSON.stringify([null, ['c_5d7e6da7217923ea', 'r_88798db14c2d9b3d'], { key: 'val' }, null]);
    const payload5_no_candidates = JSON.stringify([null, ['c_id', 'r_id'], null, null, null]);
    const payload5_empty_candidates = JSON.stringify([null, ['c_id', 'r_id'], null, null, []]);
    const frames = [
      ")]}'",
      '42',
      JSON.stringify(['wrb.fr', null, payload4]),
      JSON.stringify(['wrb.fr', null, payload5_no_candidates]),
      JSON.stringify(['wrb.fr', null, payload5_empty_candidates]),
      '',
    ].join('\n');

    const events = parseGeminiFrameStream(frames);
    expect(events).toEqual([]);
  });

  it('skips non-array object metadata frames', () => {
    // Object inner payload (non-array) should be skipped entirely
    const payload = JSON.stringify({ some: 'metadata', response: 'data' });
    const frames = [
      ")]}'",
      '42',
      JSON.stringify(['wrb.fr', null, payload]),
      '',
    ].join('\n');

    const events = parseGeminiFrameStream(frames);
    expect(events).toEqual([]);
  });
});
