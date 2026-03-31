import type { Browser, PaperFormat } from 'puppeteer-core';
import type { PaperOptions, PdfOptions } from '../../types/index.js';

const PAPER_SIZES: Record<string, { width: string; height: string }> = {
  A4: { width: '210mm', height: '297mm' },
  A3: { width: '297mm', height: '420mm' },
  Letter: { width: '8.5in', height: '11in' },
  Legal: { width: '8.5in', height: '14in' },
  Tabloid: { width: '11in', height: '17in' },
};

export class PdfService {
  private browser: Browser | null = null;

  async getBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }
    // Dynamic import to allow mocking in tests
    const puppeteer = await import('puppeteer-core');
    const chromium = await import('@sparticuz/chromium');

    this.browser = await puppeteer.default.launch({
      args: chromium.default.args.filter((arg: string) => !arg.startsWith('--headless')),
      executablePath: await chromium.default.executablePath(),
      headless: true,
    });

    return this.browser;
  }

  async generate(
    html: string,
    paper?: PaperOptions,
    options?: PdfOptions,
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const hasHeaderFooter = !!(options?.headerTemplate || options?.footerTemplate);

      const pdfOptions: Parameters<typeof page.pdf>[0] = {
        printBackground: options?.printBackground ?? false,
        scale: options?.scale,
        margin: options?.margin
          ? {
              top: options.margin.top,
              right: options.margin.right,
              bottom: options.margin.bottom,
              left: options.margin.left,
            }
          : undefined,
        displayHeaderFooter: hasHeaderFooter,
        headerTemplate: options?.headerTemplate ?? '',
        footerTemplate: options?.footerTemplate ?? '',
      };

      // Apply paper size
      if (paper?.size && PAPER_SIZES[paper.size]) {
        const { width, height } = PAPER_SIZES[paper.size];
        if (paper.orientation === 'landscape') {
          pdfOptions.width = height;
          pdfOptions.height = width;
        } else {
          pdfOptions.width = width;
          pdfOptions.height = height;
        }
      } else if (paper?.size) {
        pdfOptions.format = paper.size as PaperFormat;
        pdfOptions.landscape = paper.orientation === 'landscape';
      }

      const pdfBuffer = await page.pdf(pdfOptions);
      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
