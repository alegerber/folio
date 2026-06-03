import { PdfService, PAGE_TIMEOUT_MS } from '../pdf/PdfService.js';
import type { ScreenshotRequest } from '../../types/index.js';

export class ScreenshotService {
  constructor(private readonly pdfService: PdfService) {}

  async capture(request: ScreenshotRequest): Promise<{ buffer: Buffer; mimeType: string }> {
    const format = request.format ?? 'png';
    // newPage() applies the shared timeout and the SSRF request-interception
    // guard, so screenshots get the same protection as PDF generation.
    const page = await this.pdfService.newPage();

    try {
      await page.setViewport(request.viewport ?? { width: 1280, height: 720 });

      if (request.url) {
        await page.goto(request.url, { waitUntil: 'networkidle0', timeout: PAGE_TIMEOUT_MS });
      } else if (request.html) {
        // puppeteer 25 removed networkidle* from setContent; 'load' still waits
        // for referenced resources (images/CSS/fonts) via the window load event.
        await page.setContent(request.html, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
      } else {
        throw new Error('capture() requires either html or url');
      }

      if (request.css) {
        await page.addStyleTag({ content: request.css });
      }

      const buffer = Buffer.from(
        await page.screenshot({
          type: format,
          quality: format === 'png' ? undefined : request.quality,
          fullPage: request.fullPage ?? false,
          clip: request.clip,
        }),
      );

      return { buffer, mimeType: `image/${format}` };
    } finally {
      await page.close();
    }
  }
}
