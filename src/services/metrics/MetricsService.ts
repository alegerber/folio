const DURATION_BUCKETS_MS = [100, 250, 500, 1000, 2500, 5000, 10000];
const SIZE_BUCKETS_BYTES = [10240, 51200, 102400, 512000, 1048576, 5242880, 10485760];

interface Histogram {
  buckets: Map<number, number>;
  sum: number;
  count: number;
}

function createHistogram(upperBounds: number[]): Histogram {
  const buckets = new Map<number, number>();
  for (const bound of upperBounds) {
    buckets.set(bound, 0);
  }
  return { buckets, sum: 0, count: 0 };
}

function recordValue(histogram: Histogram, value: number): void {
  histogram.sum += value;
  histogram.count += 1;
  for (const [bound, count] of histogram.buckets) {
    if (value <= bound) {
      histogram.buckets.set(bound, count + 1);
    }
  }
}

function formatHistogram(name: string, help: string, histogram: Histogram): string {
  const lines: string[] = [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} histogram`,
  ];
  for (const [bound, count] of histogram.buckets) {
    lines.push(`${name}_bucket{le="${bound}"} ${count}`);
  }
  lines.push(`${name}_bucket{le="+Inf"} ${histogram.count}`);
  lines.push(`${name}_sum ${histogram.sum}`);
  lines.push(`${name}_count ${histogram.count}`);
  return lines.join('\n');
}

// Prometheus label values must escape backslash, double-quote and newline.
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export class MetricsService {
  private durationMs = createHistogram(DURATION_BUCKETS_MS);
  private sizeBytes = createHistogram(SIZE_BUCKETS_BYTES);
  private successCount = 0;
  private errorCount = 0;

  // Per-route request metrics covering every endpoint (generate, merge, split,
  // compress, pdfa, screenshot, …), fed by an onResponse hook. NOTE: like all
  // counters here these are in-memory and per-instance — on Lambda each warm
  // instance keeps its own values, so a scrape reflects one instance, not the
  // whole fleet. Use a push-based exporter (e.g. EMF) for fleet-wide metrics.
  private httpDurationMs = createHistogram(DURATION_BUCKETS_MS);
  private httpCounts = new Map<string, { success: number; error: number }>();

  recordSuccess(durationMs: number, sizeBytes: number): void {
    recordValue(this.durationMs, durationMs);
    recordValue(this.sizeBytes, sizeBytes);
    this.successCount += 1;
  }

  recordError(): void {
    this.errorCount += 1;
  }

  recordHttpRequest(route: string, durationMs: number, statusCode: number): void {
    recordValue(this.httpDurationMs, durationMs);
    const entry = this.httpCounts.get(route) ?? { success: 0, error: 0 };
    if (statusCode >= 500) {
      entry.error += 1;
    } else {
      entry.success += 1;
    }
    this.httpCounts.set(route, entry);
  }

  private httpCounterLines(): string[] {
    const lines = [
      '# HELP http_requests_total Total HTTP requests by route and status',
      '# TYPE http_requests_total counter',
    ];
    for (const [route, { success, error }] of this.httpCounts) {
      const r = escapeLabel(route);
      lines.push(`http_requests_total{route="${r}",status="success"} ${success}`);
      lines.push(`http_requests_total{route="${r}",status="error"} ${error}`);
    }
    return lines;
  }

  format(): string {
    return [
      formatHistogram(
        'pdf_generation_duration_ms',
        'Duration of PDF generation in milliseconds',
        this.durationMs,
      ),
      '',
      formatHistogram(
        'pdf_size_bytes',
        'Size of generated PDF in bytes',
        this.sizeBytes,
      ),
      '',
      '# HELP pdf_generation_requests_total Total number of PDF generation requests',
      '# TYPE pdf_generation_requests_total counter',
      `pdf_generation_requests_total{status="success"} ${this.successCount}`,
      `pdf_generation_requests_total{status="error"} ${this.errorCount}`,
      '',
      formatHistogram(
        'http_request_duration_ms',
        'Duration of all HTTP requests in milliseconds',
        this.httpDurationMs,
      ),
      '',
      ...this.httpCounterLines(),
    ].join('\n');
  }
}
