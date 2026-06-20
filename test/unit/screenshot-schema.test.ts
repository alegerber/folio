import { describe, it, expect } from 'vitest';
import {
  screenshotRequestSchema,
  screenshotRequestJsonSchema,
} from '../../src/routes/screenshot/schema.js';

describe('screenshotRequestSchema — defaults', () => {
  it('applies png/non-fullPage/non-stream defaults for a minimal request', () => {
    const result = screenshotRequestSchema.parse({ html: '<h1>hi</h1>' });
    expect(result.format).toBe('png');
    expect(result.fullPage).toBe(false);
    expect(result.stream).toBe(false);
  });

  it('defaults viewport width/height when an empty viewport object is given', () => {
    const result = screenshotRequestSchema.parse({ html: 'x', viewport: {} });
    expect(result.viewport).toEqual({ width: 1280, height: 720 });
  });

  // Like the PDF route, the "html XOR url" rule is enforced in the handler.
  it('accepts an empty body at the schema level (XOR lives in the handler)', () => {
    expect(screenshotRequestSchema.safeParse({}).success).toBe(true);
  });
});

describe('screenshotRequestSchema — content bounds', () => {
  it('accepts a url-only request', () => {
    expect(screenshotRequestSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
  });

  it('rejects a malformed url', () => {
    expect(screenshotRequestSchema.safeParse({ url: 'not-a-url' }).success).toBe(false);
  });

  it('rejects empty html', () => {
    expect(screenshotRequestSchema.safeParse({ html: '' }).success).toBe(false);
  });
});

describe('screenshotRequestSchema — viewport limits', () => {
  it.each([
    [{ width: 3841, height: 720 }, 'width above 3840'],
    [{ width: 1280, height: 2161 }, 'height above 2160'],
    [{ width: 0, height: 720 }, 'width below 1'],
  ])('rejects viewport %j (%s)', (viewport) => {
    expect(screenshotRequestSchema.safeParse({ html: 'x', viewport }).success).toBe(false);
  });

  it('accepts viewport at the upper bounds', () => {
    expect(
      screenshotRequestSchema.safeParse({ html: 'x', viewport: { width: 3840, height: 2160 } })
        .success,
    ).toBe(true);
  });
});

describe('screenshotRequestSchema — format and quality', () => {
  it.each(['png', 'jpeg', 'webp'])('accepts format %j', (format) => {
    expect(screenshotRequestSchema.safeParse({ html: 'x', format }).success).toBe(true);
  });

  it('rejects an unsupported format', () => {
    expect(screenshotRequestSchema.safeParse({ html: 'x', format: 'gif' }).success).toBe(false);
  });

  it.each([0, 101])('rejects out-of-range quality %j', (quality) => {
    expect(screenshotRequestSchema.safeParse({ html: 'x', quality }).success).toBe(false);
  });

  it('accepts in-range quality', () => {
    expect(screenshotRequestSchema.safeParse({ html: 'x', quality: 80 }).success).toBe(true);
  });
});

describe('screenshotRequestSchema — clip region', () => {
  it('accepts a clip with positive dimensions', () => {
    expect(
      screenshotRequestSchema.safeParse({
        html: 'x',
        clip: { x: 0, y: 0, width: 100, height: 50 },
      }).success,
    ).toBe(true);
  });

  it('rejects a clip with non-positive width', () => {
    expect(
      screenshotRequestSchema.safeParse({
        html: 'x',
        clip: { x: 0, y: 0, width: 0, height: 50 },
      }).success,
    ).toBe(false);
  });
});

describe('screenshot generated JSON schema', () => {
  it('strips the draft-2020-12 $schema key for AJV compatibility', () => {
    expect(screenshotRequestJsonSchema).not.toHaveProperty('$schema');
  });
});
