import { z } from 'zod';

export const screenshotRequestSchema = z.object({
  html: z.string().min(1).optional(),
  url: z.url().optional(),
  css: z.string().optional(),
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
