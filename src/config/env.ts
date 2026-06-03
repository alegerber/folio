import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    S3_BUCKET: z.string().min(1),
    AWS_REGION: z.string().min(1),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_ENDPOINT_URL: z.url().optional(),
    AWS_PUBLIC_ENDPOINT_URL: z.url().optional(),
    SIGNED_URL_EXPIRY_SECONDS: z.coerce.number().int().positive().default(3600),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    PORT: z.coerce.number().int().positive().default(8080),
    API_KEY: z.string().min(32).optional(),
    GHOSTSCRIPT_PATH: z.string().optional(),
    // Secure by default: only explicit falsy tokens disable the guard; an
    // unset var or any other value keeps protection on.
    SSRF_PROTECTION: z
      .string()
      .optional()
      .transform((v) => v === undefined || !['false', '0', 'no', 'off'].includes(v.toLowerCase())),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  })
  // Auth is optional for local/dev, but must be configured in production so a
  // deployment can never silently come up unauthenticated.
  .refine((e) => e.NODE_ENV !== 'production' || !!e.API_KEY, {
    message: 'API_KEY (min 32 chars) is required when NODE_ENV=production',
    path: ['API_KEY'],
  });

export type Env = z.infer<typeof envSchema>;

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment variables:', z.flattenError(result.error).fieldErrors);
  process.exit(1);
}

export const env = result.data;
