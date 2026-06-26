import { describe, expect, it } from 'vitest';
import { FrameParseError, parseGeminiFrameStream } from '../src/transform/frame-parser.js';

function wrbFrame(fullText: string): string {
  return JSON.stringify(['wrb.fr', null, JSON.stringify([null, null, null, null, fullText])]);
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
    const payload = JSON.stringify([null, ['c_id', 'r_id'], null, null, [['rc_id', ['Hello ', 'world']]]]);
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

  it('maps known upstream error sequence to error event', () => {
    const events = parseGeminiFrameStream(`${JSON.stringify(['wrb.fr', null, JSON.stringify([[5, 2, 0, 1, 0]])])}\n`);

    expect(events).toEqual([{ type: 'error', code: '1037', message: 'Gemini Web quota or upstream error' }]);
  });
});
