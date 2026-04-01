import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { PDFDocument } from 'pdf-lib';
import { parsePageRange, PdfOperationsService } from './PdfOperationsService.js';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 compressed')),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

import { spawn } from 'child_process';

function makeGsProcess(exitCode = 0) {
  const proc = new EventEmitter() as NodeJS.EventEmitter & { stderr: NodeJS.EventEmitter };
  (proc as any).stderr = new EventEmitter();
  setImmediate(() => proc.emit('close', exitCode));
  return proc;
}

async function makePdf(pageCount = 3): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage();
  return Buffer.from(await doc.save());
}

describe('parsePageRange', () => {
  it('parses a single page', () => {
    expect(parsePageRange('2', 5)).toEqual([1]);
  });

  it('parses a range', () => {
    expect(parsePageRange('1-3', 5)).toEqual([0, 1, 2]);
  });

  it('parses a comma list', () => {
    expect(parsePageRange('1,3,5', 5)).toEqual([0, 2, 4]);
  });

  it('parses an open-ended range', () => {
    expect(parsePageRange('3-', 5)).toEqual([2, 3, 4]);
  });

  it('clamps out-of-range indices', () => {
    expect(parsePageRange('1-10', 3)).toEqual([0, 1, 2]);
  });

  it('deduplicates overlapping selections', () => {
    expect(parsePageRange('1-3,2-4', 5)).toEqual([0, 1, 2, 3]);
  });
});

describe('PdfOperationsService', () => {
  let service: PdfOperationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PdfOperationsService();
  });

  describe('split', () => {
    it('extracts specified pages', async () => {
      const source = await makePdf(5);
      const result = await service.split(source, '1,3,5');
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(3);
    });

    it('handles open-ended range', async () => {
      const source = await makePdf(4);
      const result = await service.split(source, '2-');
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(3);
    });

    it('throws when page range produces no pages', async () => {
      const source = await makePdf(3);
      await expect(service.split(source, '5')).rejects.toThrow('Page range produces no pages');
    });
  });

  describe('compress (pdf-lib fallback)', () => {
    it('returns a buffer when Ghostscript is not configured', async () => {
      const source = await makePdf(1);
      const result = await service.compress(source);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('compress (Ghostscript)', () => {
    beforeEach(() => {
      service = new PdfOperationsService('/usr/bin/gs');
      vi.mocked(spawn).mockReturnValue(makeGsProcess(0) as any);
    });

    it('calls Ghostscript with compress args', async () => {
      const source = await makePdf(1);
      const result = await service.compress(source);
      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/gs',
        expect.arrayContaining(['-dPDFSETTINGS=/ebook', '-sDEVICE=pdfwrite']),
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('throws when Ghostscript exits with non-zero code', async () => {
      vi.mocked(spawn).mockReturnValue(makeGsProcess(1) as any);
      const source = await makePdf(1);
      await expect(service.compress(source)).rejects.toThrow('Ghostscript exited with code 1');
    });
  });

  describe('convertToPdfA', () => {
    it('throws when Ghostscript is not configured', async () => {
      const source = await makePdf(1);
      await expect(service.convertToPdfA(source)).rejects.toThrow('Ghostscript is required');
    });

    it('calls Ghostscript with PDF/A args', async () => {
      service = new PdfOperationsService('/usr/bin/gs');
      vi.mocked(spawn).mockReturnValue(makeGsProcess(0) as any);
      const source = await makePdf(1);
      await service.convertToPdfA(source, '2b');
      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/gs',
        expect.arrayContaining(['-dPDFA=2', '-sDEVICE=pdfwrite']),
      );
    });

    it('uses the correct PDF/A level for each conformance', async () => {
      service = new PdfOperationsService('/usr/bin/gs');
      for (const [conf, level] of [['1b', 1], ['2b', 2], ['3b', 3]] as const) {
        vi.mocked(spawn).mockReturnValue(makeGsProcess(0) as any);
        const source = await makePdf(1);
        await service.convertToPdfA(source, conf);
        expect(spawn).toHaveBeenCalledWith(
          '/usr/bin/gs',
          expect.arrayContaining([`-dPDFA=${level}`]),
        );
        vi.clearAllMocks();
      }
    });
  });

  describe('canUseGhostscript', () => {
    it('is false when no ghostscript path is set', () => {
      expect(service.canUseGhostscript).toBe(false);
    });

    it('is true when ghostscript path is set', () => {
      const gsService = new PdfOperationsService('/usr/bin/gs');
      expect(gsService.canUseGhostscript).toBe(true);
    });
  });
});
