import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsService } from './MetricsService.js';

describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  describe('format() with no observations', () => {
    it('outputs histogram names and counter names', () => {
      const output = metrics.format();
      expect(output).toContain('pdf_generation_duration_ms');
      expect(output).toContain('pdf_size_bytes');
      expect(output).toContain('pdf_generation_requests_total');
    });

    it('outputs zero counts', () => {
      const output = metrics.format();
      expect(output).toContain('pdf_generation_duration_ms_count 0');
      expect(output).toContain('pdf_size_bytes_count 0');
      expect(output).toContain('pdf_generation_requests_total{status="success"} 0');
      expect(output).toContain('pdf_generation_requests_total{status="error"} 0');
    });
  });

  describe('recordSuccess()', () => {
    it('increments success counter', () => {
      metrics.recordSuccess(200, 50000);
      metrics.recordSuccess(300, 60000);
      expect(metrics.format()).toContain('pdf_generation_requests_total{status="success"} 2');
    });

    it('accumulates duration sum and count', () => {
      metrics.recordSuccess(200, 1000);
      metrics.recordSuccess(400, 2000);
      const output = metrics.format();
      expect(output).toContain('pdf_generation_duration_ms_sum 600');
      expect(output).toContain('pdf_generation_duration_ms_count 2');
    });

    it('accumulates size sum and count', () => {
      metrics.recordSuccess(100, 10000);
      metrics.recordSuccess(200, 30000);
      const output = metrics.format();
      expect(output).toContain('pdf_size_bytes_sum 40000');
      expect(output).toContain('pdf_size_bytes_count 2');
    });

    it('places value in correct duration buckets (cumulative)', () => {
      // 300ms falls into buckets >=300: 500, 1000, 2500, 5000, 10000
      metrics.recordSuccess(300, 1000);
      const output = metrics.format();
      expect(output).toContain('pdf_generation_duration_ms_bucket{le="100"} 0');
      expect(output).toContain('pdf_generation_duration_ms_bucket{le="250"} 0');
      expect(output).toContain('pdf_generation_duration_ms_bucket{le="500"} 1');
      expect(output).toContain('pdf_generation_duration_ms_bucket{le="1000"} 1');
      expect(output).toContain('pdf_generation_duration_ms_bucket{le="+Inf"} 1');
    });

    it('places value in correct size buckets (cumulative)', () => {
      // 75000 bytes falls into buckets >=75000: 102400, 512000, 1048576, 5242880, 10485760
      metrics.recordSuccess(100, 75000);
      const output = metrics.format();
      expect(output).toContain('pdf_size_bytes_bucket{le="10240"} 0');
      expect(output).toContain('pdf_size_bytes_bucket{le="51200"} 0');
      expect(output).toContain('pdf_size_bytes_bucket{le="102400"} 1');
      expect(output).toContain('pdf_size_bytes_bucket{le="+Inf"} 1');
    });
  });

  describe('recordError()', () => {
    it('increments error counter', () => {
      metrics.recordError();
      metrics.recordError();
      expect(metrics.format()).toContain('pdf_generation_requests_total{status="error"} 2');
    });

    it('does not affect histogram counts', () => {
      metrics.recordError();
      const output = metrics.format();
      expect(output).toContain('pdf_generation_duration_ms_count 0');
      expect(output).toContain('pdf_size_bytes_count 0');
    });
  });

  describe('format() output structure', () => {
    it('includes HELP and TYPE lines for each metric', () => {
      const output = metrics.format();
      expect(output).toContain('# HELP pdf_generation_duration_ms');
      expect(output).toContain('# TYPE pdf_generation_duration_ms histogram');
      expect(output).toContain('# HELP pdf_size_bytes');
      expect(output).toContain('# TYPE pdf_size_bytes histogram');
      expect(output).toContain('# HELP pdf_generation_requests_total');
      expect(output).toContain('# TYPE pdf_generation_requests_total counter');
    });

    it('includes +Inf bucket equal to total count', () => {
      metrics.recordSuccess(50, 5000);
      metrics.recordSuccess(9999, 9999999);
      const output = metrics.format();
      expect(output).toContain('pdf_generation_duration_ms_bucket{le="+Inf"} 2');
      expect(output).toContain('pdf_size_bytes_bucket{le="+Inf"} 2');
    });
  });
});
