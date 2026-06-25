export interface GeminiDeltaEvent {
  readonly type: 'delta';
  readonly text: string;
  readonly fullText: string;
}

export interface GeminiErrorEvent {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}

export type GeminiFrameEvent = GeminiDeltaEvent | GeminiErrorEvent;

export class FrameParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameParseError';
  }
}

function isNumericLengthLine(line: string): boolean {
  return /^[0-9]+$/.test(line.trim());
}

function isRecordArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function findLongestString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    let longest: string | null = null;
    for (const item of value) {
      const candidate = findLongestString(item);
      if (candidate !== null && (longest === null || candidate.length > longest.length)) {
        longest = candidate;
      }
    }
    return longest;
  }

  if (typeof value === 'object' && value !== null) {
    let longest: string | null = null;
    for (const item of Object.values(value)) {
      const candidate = findLongestString(item);
      if (candidate !== null && (longest === null || candidate.length > longest.length)) {
        longest = candidate;
      }
    }
    return longest;
  }

  return null;
}

function containsSequence(value: unknown, sequence: readonly number[]): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  for (let index = 0; index <= value.length - sequence.length; index += 1) {
    const matches = sequence.every((expected, offset) => value[index + offset] === expected);
    if (matches) {
      return true;
    }
  }

  return value.some((item) => containsSequence(item, sequence));
}

function parseInnerPayload(frame: readonly unknown[]): unknown | null {
  const innerPayload = frame.find((item) => typeof item === 'string' && item.trim().startsWith('['));
  if (typeof innerPayload !== 'string') {
    return null;
  }

  try {
    return JSON.parse(innerPayload) as unknown;
  } catch {
    throw new FrameParseError('Unable to parse nested Gemini Web frame JSON');
  }
}

export class GeminiFrameParser {
  private buffer = '';
  private lastText = '';
  private sawFirstLine = false;

  push(chunk: string): readonly GeminiFrameEvent[] {
    this.buffer += chunk;
    const events: GeminiFrameEvent[] = [];

    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }

      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIndex + 1);
      events.push(...this.parseLine(line));
    }

    return events;
  }

  flush(): readonly GeminiFrameEvent[] {
    if (this.buffer.trim().length === 0) {
      this.buffer = '';
      return [];
    }

    const line = this.buffer;
    this.buffer = '';
    return this.parseLine(line);
  }

  private parseLine(rawLine: string): readonly GeminiFrameEvent[] {
    const line = rawLine.trim();
    if (line.length === 0) {
      return [];
    }

    if (!this.sawFirstLine) {
      this.sawFirstLine = true;
      if (line === ")]}'") {
        return [];
      }
    }

    if (isNumericLengthLine(line)) {
      return [];
    }

    let outer: unknown;
    try {
      outer = JSON.parse(line) as unknown;
    } catch {
      throw new FrameParseError('Unable to parse Gemini Web frame JSON line');
    }

    if (!isRecordArray(outer)) {
      return [];
    }

    if (outer[0] !== 'wrb.fr') {
      return [];
    }

    const inner = parseInnerPayload(outer);
    if (inner === null) {
      return [];
    }

    if (containsSequence(inner, [5, 2, 0, 1, 0])) {
      return [{ type: 'error', code: '1037', message: 'Gemini Web quota or upstream error' }];
    }

    const fullText = findLongestString(inner);
    if (fullText === null || fullText.length === 0) {
      return [];
    }

    const delta = fullText.startsWith(this.lastText) ? fullText.slice(this.lastText.length) : fullText;
    this.lastText = fullText;

    if (delta.length === 0) {
      return [];
    }

    return [{ type: 'delta', text: delta, fullText }];
  }
}

export function parseGeminiFrameStream(input: string, chunkSize = input.length): readonly GeminiFrameEvent[] {
  const parser = new GeminiFrameParser();
  const events: GeminiFrameEvent[] = [];

  for (let index = 0; index < input.length; index += chunkSize) {
    events.push(...parser.push(input.slice(index, index + chunkSize)));
  }
  events.push(...parser.flush());

  return events;
}
