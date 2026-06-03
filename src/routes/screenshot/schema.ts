import { z } from 'zod';

// Mirrors the PDF route's content bounds so AJV enforces maxLength at the edge.
const MAX_HTML_LENGTH = 2_000_000;
const MAX_CSS_LENGTH = 500_000;

export const screenshotRequestSchema = z.object({
  html: z.string().min(1).max(MAX_HTML_LENGTH).optional(),
  url: z.url().optional(),
  css: z.string().max(MAX_CSS_LENGTH).optional(),
  viewport: z
    .object({
      width: z.number().int().min(1).max(3840).default(1280),
      height: z.number().int().min(1).max(2160).default(720),
    })
    .optional(),
  format: z.enum(['png', 'jpeg', 'webp']).default('png'),
  quality: z.number().int().min(1).max(100).optional(),
  fullPage: z.boolean().default(false),
  clip: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
  stream: z.boolean().default(false),
});

export type ScreenshotRequestInput = z.infer<typeof screenshotRequestSchema>;

const { $schema: _$schema, ...screenshotRequestJsonSchema } = z.toJSONSchema(screenshotRequestSchema);
export { screenshotRequestJsonSchema };
