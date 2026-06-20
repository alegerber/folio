import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// env.ts validates process.env at import time and calls process.exit(1) on
// failure. We stub a known-good environment first, then dynamically import the
// module so its top-level validation passes; afterwards we exercise the
// exported schema directly with constructed inputs (process.env no longer
// matters for those assertions).
let envSchema: typeof import('./env.js').envSchema;

beforeAll(async () => {
  vi.stubEnv('S3_BUCKET', 'valid-bucket');
  vi.stubEnv('AWS_REGION', 'eu-central-1');
  ({ envSchema } = await import('./env.js'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// Minimal set of required vars; spread into each case and override per test.
const base = { S3_BUCKET: 'valid-bucket', AWS_REGION: 'eu-central-1' } as const;

describe('envSchema — production auth guard', () => {
  it('rejects production without an API_KEY', () => {
    const result = envSchema.safeParse({ ...base, NODE_ENV: 'production' });
    expect(result.success).toBe(false);
    if (!result.success) {
      // The refine pins the error to the API_KEY path so the message is actionable.
      expect(result.error.issues[0].path).toEqual(['API_KEY']);
    }
  });

  it('accepts production with a 32-char API_KEY', () => {
    const result = envSchema.safeParse({
      ...base,
      NODE_ENV: 'production',
      API_KEY: 'a'.repeat(32),
    });
    expect(result.success).toBe(true);
  });

  it('allows non-production environments without an API_KEY', () => {
    expect(envSchema.safeParse({ ...base, NODE_ENV: 'development' }).success).toBe(true);
  });

  it('rejects an API_KEY shorter than 32 chars', () => {
    expect(envSchema.safeParse({ ...base, API_KEY: 'a'.repeat(31) }).success).toBe(false);
  });
});

describe('envSchema — SSRF_PROTECTION secure-by-default transform', () => {
  it('defaults to enabled when unset', () => {
    expect(envSchema.parse({ ...base }).SSRF_PROTECTION).toBe(true);
  });

  it.each(['false', '0', 'no', 'off', 'OFF', 'False'])(
    'disables protection for the explicit falsy token %j',
    (token) => {
      expect(envSchema.parse({ ...base, SSRF_PROTECTION: token }).SSRF_PROTECTION).toBe(false);
    },
  );

  it.each(['true', '1', 'yes', 'anything', ''])(
    'keeps protection on for any non-falsy token %j',
    (token) => {
      expect(envSchema.parse({ ...base, SSRF_PROTECTION: token }).SSRF_PROTECTION).toBe(true);
    },
  );
});

describe('envSchema — coercion and numeric defaults', () => {
  it('applies defaults when numeric vars are absent', () => {
    const env = envSchema.parse({ ...base });
    expect(env.SIGNED_URL_EXPIRY_SECONDS).toBe(3600);
    expect(env.PORT).toBe(8080);
    expect(env.RATE_LIMIT_MAX).toBe(60);
    expect(env.RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it('coerces numeric strings to numbers', () => {
    const env = envSchema.parse({ ...base, PORT: '3000', SIGNED_URL_EXPIRY_SECONDS: '7200' });
    expect(env.PORT).toBe(3000);
    expect(env.SIGNED_URL_EXPIRY_SECONDS).toBe(7200);
  });

  it.each(['0', '-1', '1.5'])('rejects non-positive / non-integer PORT %j', (port) => {
    expect(envSchema.safeParse({ ...base, PORT: port }).success).toBe(false);
  });
});

describe('envSchema — enum defaults', () => {
  it('defaults NODE_ENV to development and LOG_LEVEL to info', () => {
    const env = envSchema.parse({ ...base });
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(envSchema.safeParse({ ...base, LOG_LEVEL: 'verbose' }).success).toBe(false);
  });
});

describe('envSchema — S3_BUCKET name rules', () => {
  it.each(['my-bucket', 'my.bucket-1', 'abc'])('accepts valid bucket name %j', (name) => {
    expect(envSchema.safeParse({ ...base, S3_BUCKET: name }).success).toBe(true);
  });

  it.each([
    ['ab', 'shorter than 3 chars'],
    ['Ab-bucket', 'uppercase letters'],
    ['-bucket', 'leading dash'],
    ['bucket_', 'trailing underscore'],
  ])('rejects %j (%s)', (name) => {
    expect(envSchema.safeParse({ ...base, S3_BUCKET: name }).success).toBe(false);
  });

  it('rejects a bucket name longer than 63 chars', () => {
    expect(envSchema.safeParse({ ...base, S3_BUCKET: 'a'.repeat(64) }).success).toBe(false);
  });
});

describe('envSchema — AWS_REGION format', () => {
  it.each(['eu-central-1', 'us-east-1', 'ap-southeast-2'])('accepts %j', (region) => {
    expect(envSchema.safeParse({ ...base, AWS_REGION: region }).success).toBe(true);
  });

  it.each(['EU-CENTRAL-1', 'eucentral1', 'eu_central_1', 'eu-central'])('rejects %j', (region) => {
    expect(envSchema.safeParse({ ...base, AWS_REGION: region }).success).toBe(false);
  });
});

describe('envSchema — optional endpoint URLs', () => {
  it('accepts a valid AWS_ENDPOINT_URL', () => {
    expect(
      envSchema.safeParse({ ...base, AWS_ENDPOINT_URL: 'http://localhost:9000' }).success,
    ).toBe(true);
  });

  it('rejects a malformed AWS_ENDPOINT_URL', () => {
    expect(envSchema.safeParse({ ...base, AWS_ENDPOINT_URL: 'not a url' }).success).toBe(false);
  });
});

describe('env module — fail-fast on invalid configuration', () => {
  it('exits the process when a required var is invalid at import time', async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    // Force invalid config regardless of the ambient environment.
    vi.stubEnv('S3_BUCKET', '');
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(import('./env.js')).rejects.toThrow('process.exit:1');
    expect(errorLog).toHaveBeenCalledWith('Invalid environment variables:', expect.anything());

    exit.mockRestore();
    errorLog.mockRestore();
  });
});
