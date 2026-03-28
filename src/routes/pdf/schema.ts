import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const generateRequestSchema = z.object({
  html: z.string().min(1, 'html is required'),
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
    })
    .optional(),
  stream: z.boolean().optional().default(false),
});

export type GenerateRequestInput = z.infer<typeof generateRequestSchema>;

export const generateRequestJsonSchema = zodToJsonSchema(generateRequestSchema, {
  name: 'GenerateRequest',
  target: 'jsonSchema7',
});
