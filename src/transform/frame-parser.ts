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

  /**
   * Extract response text from StreamGenerate response format.
   *
   * StreamGenerate payload structure (after parsing inner JSON):
   *   [null, ["c_id","r_id"], null, null, [[candidate_id, [text_parts], ...]], ...]
   *                                                 ^^^^^^^^^^^^^^^^
   * Text is at: parsedPayload[4][n][1] where [1] is an array of text strings.
   *
   * Returns null if the payload doesn't match this format.
   */
  private extractStreamGenerateText(parsedPayload: unknown): string | null {
    if (!Array.isArray(parsedPayload) || parsedPayload.length < 5) {
      return null;
    }

    const candidates = parsedPayload[4];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }

    // For each candidate, the actual response text is at candidate[1][0] (first text part).
    // Subsequent text parts may contain encrypted context data, not response text.
    let fullText = '';

    for (const candidate of candidates) {
      if (!Array.isArray(candidate) || candidate.length < 2) {
        continue;
      }

      const textParts = candidate[1];
      if (!Array.isArray(textParts) || textParts.length === 0) {
        continue;
      }

      // Only use the first text part — the rest are non-text metadata/context blobs
      if (typeof textParts[0] === 'string') {
        fullText += textParts[0];
      }
    }

    return fullText.length > 0 ? fullText : null;
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

    // The response can be either:
    //   [["wrb.fr", null, payload]]   — batch wrapper (StreamGenerate)
    //   ["wrb.fr", null, payload]     — direct frame (batchexecute / test)
    // Unwrap batch wrapper to get frames, then process each frame.
    const frames: readonly unknown[] = isRecordArray(outer[0]) ? outer : [outer];

    const events: GeminiFrameEvent[] = [];
    for (const frame of frames) {
      events.push(...this.processFrame(frame));
    }
    return events;
  }

  private processFrame(frame: unknown): readonly GeminiFrameEvent[] {
    if (!isRecordArray(frame) || frame[0] !== 'wrb.fr') {
      return [];
    }

    const inner = parseInnerPayload(frame);
    if (inner === null) {
      return [];
    }

    if (containsSequence(inner, [5, 2, 0, 1, 0])) {
      return [{ type: 'error', code: '1037', message: 'Gemini Web quota or upstream error' }];
    }

    // Try StreamGenerate response format: payload[4] = [[candidate_id, [text_parts], ...]]
    if (Array.isArray(inner) && inner.length >= 5) {
      // payload[4] is the candidates slot
      if (inner[4] === undefined || inner[4] === null) {
        // Candidate slot exists but empty — skip (no response yet)
        return [];
      }

      if (Array.isArray(inner[4])) {
        const candidateText = this.extractStreamGenerateText(inner);
        if (candidateText !== null) {
          const delta = candidateText.startsWith(this.lastText) ? candidateText.slice(this.lastText.length) : candidateText;
          this.lastText = candidateText;
          if (delta.length > 0) {
            return [{ type: 'delta', text: delta, fullText: candidateText }];
          }
          return [];
        }
      }

      // payload[4] is a non-array (e.g. metadata object) — skip frame
      return [];
    }

    // Legacy batchexecute format — fall back to longest string heuristic
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
