import { PDFDocument } from 'pdf-lib';
import { spawn } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';

export function parsePageRange(expr: string, totalPages: number): number[] {
  const indices: number[] = [];
  for (const part of expr.split(',')) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-');
      const from = start ? parseInt(start, 10) - 1 : 0;
      const to = end ? parseInt(end, 10) - 1 : totalPages - 1;
      for (let i = from; i <= to; i++) indices.push(i);
    } else {
      indices.push(parseInt(trimmed, 10) - 1);
    }
  }
  return [...new Set(indices)].filter((i) => i >= 0 && i < totalPages);
}

function runGhostscript(gsPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const gs = spawn(gsPath, args);
    let stderr = '';
    gs.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    gs.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Ghostscript exited with code ${code}: ${stderr}`));
      }
    });
    gs.on('error', reject);
  });
}

export class PdfOperationsService {
  constructor(private readonly ghostscriptPath?: string) {}

  get canUseGhostscript(): boolean {
    return !!this.ghostscriptPath;
  }

  async split(sourceBytes: Buffer, pages: string): Promise<Buffer> {
    const source = await PDFDocument.load(sourceBytes);
    const totalPages = source.getPageCount();
    const indices = parsePageRange(pages, totalPages);

    if (indices.length === 0) {
      throw new Error('Page range produces no pages');
    }

    const output = await PDFDocument.create();
    const copied = await output.copyPages(source, indices);
    copied.forEach((page) => output.addPage(page));
    return Buffer.from(await output.save());
  }

  async compress(sourceBytes: Buffer): Promise<Buffer> {
    if (this.ghostscriptPath) {
      return this.ghostscriptCompress(sourceBytes);
    }
    // Fallback: re-save with object streams (compresses xref tables)
    const doc = await PDFDocument.load(sourceBytes);
    return Buffer.from(await doc.save({ useObjectStreams: true }));
  }

  async convertToPdfA(sourceBytes: Buffer, conformance: '1b' | '2b' | '3b' = '2b'): Promise<Buffer> {
    if (!this.ghostscriptPath) {
      throw new Error('Ghostscript is required for PDF/A conversion');
    }
    return this.ghostscriptPdfA(sourceBytes, conformance);
  }

  private async ghostscriptCompress(sourceBytes: Buffer): Promise<Buffer> {
    const id = randomUUID();
    const inPath = join(tmpdir(), `pdf-compress-in-${id}.pdf`);
    const outPath = join(tmpdir(), `pdf-compress-out-${id}.pdf`);
    try {
      await writeFile(inPath, sourceBytes);
      await runGhostscript(this.ghostscriptPath!, [
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        '-dPDFSETTINGS=/ebook',
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        `-sOutputFile=${outPath}`,
        inPath,
      ]);
      return await readFile(outPath);
    } finally {
      await Promise.allSettled([unlink(inPath), unlink(outPath)]);
    }
  }

  private async ghostscriptPdfA(sourceBytes: Buffer, conformance: '1b' | '2b' | '3b'): Promise<Buffer> {
    const levelMap: Record<string, number> = { '1b': 1, '2b': 2, '3b': 3 };
    const level = levelMap[conformance];
    const id = randomUUID();
    const inPath = join(tmpdir(), `pdf-pdfa-in-${id}.pdf`);
    const outPath = join(tmpdir(), `pdf-pdfa-out-${id}.pdf`);
    try {
      await writeFile(inPath, sourceBytes);
      await runGhostscript(this.ghostscriptPath!, [
        `-dPDFA=${level}`,
        '-dBATCH',
        '-dNOPAUSE',
        '-sDEVICE=pdfwrite',
        '-sColorConversionStrategy=UseDeviceIndependentColor',
        '-dPDFACompatibilityPolicy=1',
        `-sOutputFile=${outPath}`,
        inPath,
      ]);
      return await readFile(outPath);
    } finally {
      await Promise.allSettled([unlink(inPath), unlink(outPath)]);
    }
  }
}
