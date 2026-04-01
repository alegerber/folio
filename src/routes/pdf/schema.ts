import { z } from 'zod';

export const generateRequestSchema = z.object({
  html: z.string().min(1, 'html is required'),
  css: z.string().optional(),
  paper: z
    .object({
      size: z.string().optional(),
      orientation: z.enum(['portrait', 'landscape']).optional(),
    })
    .optional(),
  options: z
    .object({
      margin: z
        .object({
          top: z.string().optional(),
          right: z.string().optional(),
          bottom: z.string().optional(),
          left: z.string().optional(),
        })
        .optional(),
      scale: z.number().min(0.1).max(2.0).optional(),
      printBackground: z.boolean().optional(),
      headerTemplate: z.string().optional(),
      footerTemplate: z.string().optional(),
    })
    .optional(),
  stream: z.boolean().optional().default(false),
});

export type GenerateRequestInput = z.infer<typeof generateRequestSchema>;

// Strip $schema so Fastify's AJV (draft-07) doesn't try to resolve the
// draft/2020-12 meta-schema that zod v4 emits by default.
const { $schema: _$schema, ...generateRequestJsonSchema } = z.toJSONSchema(generateRequestSchema);
export { generateRequestJsonSchema };
