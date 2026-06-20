import { describe, it, expect } from 'vitest';
import {
  generateRequestSchema,
  generateRequestJsonSchema,
  pdfIdParamsSchema,
  mergeRequestSchema,
  splitRequestSchema,
  compressRequestSchema,
  pdfARequestSchema,
  MAX_HTML_LENGTH,
  MAX_CSS_LENGTH,
  MAX_MERGE_IDS,
  MAX_COOKIES,
} from './schema.js';

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const UUID2 = 'c9bf9e57-1685-4c89-bafb-ff5af830be8a';

describe('generateRequestSchema — content sources', () => {
  it('accepts an html-only request and defaults stream to false', () => {
    const result = generateRequestSchema.parse({ html: '<h1>hi</h1>' });
    expect(result.stream).toBe(false);
  });

  it('accepts a url-only request', () => {
    expect(generateRequestSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
  });

  // The "html XOR url" rule is intentionally enforced in the handler, not the
  // schema (a zod .refine() would complicate the JSON-Schema emitted for AJV).
  // This test documents that the schema itself accepts both-absent.
  it('accepts an empty body at the schema level (XOR lives in the handler)', () => {
    expect(generateRequestSchema.safeParse({}).success).toBe(true);
  });

  it('rejects empty html (min length 1)', () => {
    expect(generateRequestSchema.safeParse({ html: '' }).success).toBe(false);
  });

  it('rejects html exceeding MAX_HTML_LENGTH', () => {
    expect(generateRequestSchema.safeParse({ html: 'a'.repeat(MAX_HTML_LENGTH + 1) }).success).toBe(
      false,
    );
  });

  it('rejects css exceeding MAX_CSS_LENGTH', () => {
    expect(
      generateRequestSchema.safeParse({ html: 'x', css: 'a'.repeat(MAX_CSS_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it('rejects a malformed url', () => {
    expect(generateRequestSchema.safeParse({ url: 'not-a-url' }).success).toBe(false);
  });
});

describe('generateRequestSchema — paper and render options', () => {
  it('accepts known paper sizes and orientations', () => {
    expect(
      generateRequestSchema.safeParse({
        html: 'x',
        paper: { size: 'A4', orientation: 'landscape' },
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown paper size', () => {
    expect(generateRequestSchema.safeParse({ html: 'x', paper: { size: 'B5' } }).success).toBe(
      false,
    );
  });

  it.each([0.05, 2.5])('rejects out-of-range scale %j', (scale) => {
    expect(generateRequestSchema.safeParse({ html: 'x', options: { scale } }).success).toBe(false);
  });

  it('accepts an in-range scale', () => {
    expect(generateRequestSchema.safeParse({ html: 'x', options: { scale: 1.5 } }).success).toBe(
      true,
    );
  });
});

describe('generateRequestSchema — cookies and headers', () => {
  it('accepts a well-formed cookie', () => {
    expect(
      generateRequestSchema.safeParse({
        html: 'x',
        cookies: [{ name: 'session', value: 'abc', domain: 'example.com' }],
      }).success,
    ).toBe(true);
  });

  it('rejects a cookie missing its domain', () => {
    expect(
      generateRequestSchema.safeParse({ html: 'x', cookies: [{ name: 'a', value: 'b' }] }).success,
    ).toBe(false);
  });

  it('rejects more than MAX_COOKIES cookies', () => {
    const cookies = Array.from({ length: MAX_COOKIES + 1 }, (_, i) => ({
      name: `c${i}`,
      value: 'v',
      domain: 'example.com',
    }));
    expect(generateRequestSchema.safeParse({ html: 'x', cookies }).success).toBe(false);
  });

  it('accepts string-valued extra headers', () => {
    expect(
      generateRequestSchema.safeParse({ html: 'x', extraHeaders: { 'X-Trace': 'id-1' } }).success,
    ).toBe(true);
  });
});

describe('pdfIdParamsSchema', () => {
  it('accepts a valid uuid', () => {
    expect(pdfIdParamsSchema.safeParse({ id: UUID }).success).toBe(true);
  });

  it('rejects a non-uuid id', () => {
    expect(pdfIdParamsSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('mergeRequestSchema', () => {
  it('accepts two uuids and defaults stream to false', () => {
    const result = mergeRequestSchema.parse({ ids: [UUID, UUID2] });
    expect(result.stream).toBe(false);
  });

  it('rejects fewer than two ids', () => {
    expect(mergeRequestSchema.safeParse({ ids: [UUID] }).success).toBe(false);
  });

  it('rejects more than MAX_MERGE_IDS ids', () => {
    const ids = Array.from({ length: MAX_MERGE_IDS + 1 }, () => UUID);
    expect(mergeRequestSchema.safeParse({ ids }).success).toBe(false);
  });

  it('rejects a non-uuid in the list', () => {
    expect(mergeRequestSchema.safeParse({ ids: [UUID, 'nope'] }).success).toBe(false);
  });
});

describe('splitRequestSchema', () => {
  it('accepts an id with a pages spec', () => {
    const result = splitRequestSchema.parse({ id: UUID, pages: '1-3,5' });
    expect(result.stream).toBe(false);
  });

  it('rejects an empty pages spec', () => {
    expect(splitRequestSchema.safeParse({ id: UUID, pages: '' }).success).toBe(false);
  });
});

describe('compressRequestSchema', () => {
  it('accepts an id and defaults stream to false', () => {
    expect(compressRequestSchema.parse({ id: UUID }).stream).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    expect(compressRequestSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});

describe('pdfARequestSchema', () => {
  it('defaults conformance to 2b and stream to false', () => {
    const result = pdfARequestSchema.parse({ id: UUID });
    expect(result.conformance).toBe('2b');
    expect(result.stream).toBe(false);
  });

  it.each(['1b', '2b', '3b'])('accepts conformance level %j', (conformance) => {
    expect(pdfARequestSchema.safeParse({ id: UUID, conformance }).success).toBe(true);
  });

  it('rejects an unknown conformance level', () => {
    expect(pdfARequestSchema.safeParse({ id: UUID, conformance: '4b' }).success).toBe(false);
  });
});

describe('generated JSON schemas', () => {
  it('strips the draft-2020-12 $schema key so AJV (draft-07) can consume them', () => {
    expect(generateRequestJsonSchema).not.toHaveProperty('$schema');
  });

  it('propagates MAX_HTML_LENGTH as a maxLength constraint AJV can enforce', () => {
    const props = (generateRequestJsonSchema as { properties: Record<string, { maxLength?: number }> })
      .properties;
    expect(props.html.maxLength).toBe(MAX_HTML_LENGTH);
  });
});
