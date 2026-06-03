import { z } from 'zod';

export const MAX_MERGE_IDS = 20;
// Bounds expressed with .max()/enum so z.toJSONSchema emits maxLength/maxItems/
// enum constraints that Fastify's AJV actually enforces at the HTTP layer.
export const MAX_HTML_LENGTH = 2_000_000;
export const MAX_CSS_LENGTH = 500_000;
export const MAX_COOKIES = 50;
export const MAX_HEADER_VALUE_LENGTH = 8_192;
export const PAPER_SIZES = ['A4', 'A3', 'Letter', 'Legal', 'Tabloid'] as const;

export const generateRequestSchema = z.object({
  html: z.string().min(1).max(MAX_HTML_LENGTH).optional(),
  url: z.url().optional(),
  css: z.string().max(MAX_CSS_LENGTH).optional(),
  paper: z
    .object({
      size: z.enum(PAPER_SIZES).optional(),
      orientation: z.enum(['portrait', 'landscape']).optional(),
    })
    .optional(),
  options: z
    .object({
      margin: z
        .object({
          top: z.string().max(32).optional(),
          right: z.string().max(32).optional(),
          bottom: z.string().max(32).optional(),
          left: z.string().max(32).optional(),
        })
        .optional(),
      scale: z.number().min(0.1).max(2.0).optional(),
      printBackground: z.boolean().optional(),
      headerTemplate: z.string().max(MAX_CSS_LENGTH).optional(),
      footerTemplate: z.string().max(MAX_CSS_LENGTH).optional(),
    })
    .optional(),
  cookies: z
    .array(
      z.object({
        name: z.string().max(256),
        value: z.string().max(4_096),
        domain: z.string().max(253),
      }),
    )
    .max(MAX_COOKIES)
    .optional(),
  extraHeaders: z.record(z.string().max(256), z.string().max(MAX_HEADER_VALUE_LENGTH)).optional(),
  stream: z.boolean().optional().default(false),
});

export type GenerateRequestInput = z.infer<typeof generateRequestSchema>;

// Strip $schema so Fastify's AJV (draft-07) doesn't try to resolve the
// draft/2020-12 meta-schema that zod v4 emits by default.
const { $schema: _$schema, ...generateRequestJsonSchema } = z.toJSONSchema(generateRequestSchema);
export { generateRequestJsonSchema };

export const pdfIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export type PdfIdParams = z.infer<typeof pdfIdParamsSchema>;

const { $schema: _s1, ...pdfIdParamsJsonSchema } = z.toJSONSchema(pdfIdParamsSchema);
export { pdfIdParamsJsonSchema };

export const mergeRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(2).max(MAX_MERGE_IDS),
  stream: z.boolean().optional().default(false),
});
export type MergeRequestInput = z.infer<typeof mergeRequestSchema>;

const { $schema: _s2, ...mergeRequestJsonSchema } = z.toJSONSchema(mergeRequestSchema);
export { mergeRequestJsonSchema };

export const splitRequestSchema = z.object({
  id: z.string().uuid(),
  pages: z.string().min(1),
  stream: z.boolean().optional().default(false),
});
export type SplitRequestInput = z.infer<typeof splitRequestSchema>;

const { $schema: _s3, ...splitRequestJsonSchema } = z.toJSONSchema(splitRequestSchema);
export { splitRequestJsonSchema };

export const compressRequestSchema = z.object({
  id: z.string().uuid(),
  stream: z.boolean().optional().default(false),
});
export type CompressRequestInput = z.infer<typeof compressRequestSchema>;

const { $schema: _s4, ...compressRequestJsonSchema } = z.toJSONSchema(compressRequestSchema);
export { compressRequestJsonSchema };

export const pdfARequestSchema = z.object({
  id: z.string().uuid(),
  conformance: z.enum(['1b', '2b', '3b']).optional().default('2b'),
  stream: z.boolean().optional().default(false),
});
export type PdfARequestInput = z.infer<typeof pdfARequestSchema>;

const { $schema: _s5, ...pdfARequestJsonSchema } = z.toJSONSchema(pdfARequestSchema);
export { pdfARequestJsonSchema };
