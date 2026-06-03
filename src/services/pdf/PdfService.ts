import type { Browser, Page, HTTPRequest, PaperFormat } from 'puppeteer-core';
import type { PaperOptions, PdfOptions, CookieParam } from '../../types/index.js';
import { isRequestUrlAllowed } from '../../utils/ssrf.js';

export interface GenerateInput {
  html?: string;
  url?: string;
  css?: string;
  paper?: PaperOptions;
  options?: PdfOptions;
  cookies?: CookieParam[];
  extraHeaders?: Record<string, string>;
}

export interface PdfServiceOptions {
  // When true, every outbound Chromium request (top-level navigation, redirects
  // AND sub-resources loaded by html/url) is filtered through the SSRF guard.
  ssrfProtection?: boolean;
}

// Shared navigation/render timeout. page.setContent previously had none, which
// allowed an indefinite hang on a sub-resource that never settles.
export const PAGE_TIMEOUT_MS = 25_000;

const PAPER_SIZES: Record<string, { width: string; height: string }> = {
  A4: { width: '210mm', height: '297mm' },
  A3: { width: '297mm', height: '420mm' },
  Letter: { width: '8.5in', height: '11in' },
  Legal: { width: '8.5in', height: '14in' },
  Tabloid: { width: '11in', height: '17in' },
};

export class PdfService {
  private browserPromise: Promise<Browser> | null = null;
  private readonly ssrfProtection: boolean;

  constructor(options: PdfServiceOptions = {}) {
    this.ssrfProtection = options.ssrfProtection ?? true;
  }

  async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = this._launch().catch((err: unknown) => {
        this.browserPromise = null;
        throw err;
      });
    }
    return this.browserPromise;
  }

  private async _launch(): Promise<Browser> {
    // Dynamic import to allow mocking in tests
    const puppeteer = await import('puppeteer-core');
    const chromium = await import('@sparticuz/chromium');

    const browser = await puppeteer.default.launch({
      args: chromium.default.args.filter((arg: string) => !arg.startsWith('--headless')),
      executablePath: await chromium.default.executablePath(),
      headless: true,
    });

    // If Chromium crashes or is closed out from under us, drop the cached
    // promise so the next request relaunches instead of reusing a dead browser.
    browser.on('disconnected', () => {
      this.browserPromise = null;
    });

    return browser;
  }

  /**
   * Creates a page with the shared default timeout and, when SSRF protection is
   * enabled, request interception that blocks any request to a non-public
   * address — covering sub-resources and redirects, not just the top-level URL.
   */
  async newPage(): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);

    if (this.ssrfProtection) {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        void this.guardRequest(request);
      });
    }

    return page;
  }

  private async guardRequest(request: HTTPRequest): Promise<void> {
    const scheme = request.url().split(':', 1)[0].toLowerCase();

    // In-memory / inline schemes never touch the network.
    if (scheme === 'data' || scheme === 'blob' || scheme === 'about') {
      await request.continue().catch(() => {});
      return;
    }

    if ((scheme === 'http' || scheme === 'https') && (await isRequestUrlAllowed(request.url()))) {
      await request.continue().catch(() => {});
      return;
    }

    // Private/blocked address, or a disallowed scheme (file:, ftp:, …).
    await request.abort('blockedbyclient').catch(() => {});
  }

  async generate(input: GenerateInput): Promise<Buffer> {
    const { html, url, css, paper, options, cookies, extraHeaders } = input;
    const page = await this.newPage();

    try {
      if (cookies?.length) {
        await page.setCookie(...cookies);
      }
      if (extraHeaders) {
        await page.setExtraHTTPHeaders(extraHeaders);
      }

      if (url) {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: PAGE_TIMEOUT_MS });
      } else if (html) {
        // puppeteer 25 removed networkidle* from setContent; 'load' still waits
        // for referenced resources (images/CSS/fonts) via the window load event.
        await page.setContent(html, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
      } else {
        throw new Error('generate() requires either html or url');
      }

      if (css) {
        await page.addStyleTag({ content: css });
      }

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
    const browserPromise = this.browserPromise;
    this.browserPromise = null;

    if (browserPromise) {
      const browser = await browserPromise.catch(() => null);
      if (!browser) return;
      await browser.close();
    }
  }
}
