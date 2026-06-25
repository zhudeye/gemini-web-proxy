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

  it('maps known upstream error sequence to error event', () => {
    const events = parseGeminiFrameStream(`${JSON.stringify(['wrb.fr', null, JSON.stringify([[5, 2, 0, 1, 0]])])}\n`);

    expect(events).toEqual([{ type: 'error', code: '1037', message: 'Gemini Web quota or upstream error' }]);
  });
});
