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

export class MetricsService {
  private durationMs = createHistogram(DURATION_BUCKETS_MS);
  private sizeBytes = createHistogram(SIZE_BUCKETS_BYTES);
  private successCount = 0;
  private errorCount = 0;

  recordSuccess(durationMs: number, sizeBytes: number): void {
    recordValue(this.durationMs, durationMs);
    recordValue(this.sizeBytes, sizeBytes);
    this.successCount += 1;
  }

  recordError(): void {
    this.errorCount += 1;
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
    ].join('\n');
  }
}
