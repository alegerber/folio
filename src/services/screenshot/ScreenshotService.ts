import type { PdfService } from '../pdf/PdfService.js';
import type { ScreenshotRequest } from '../../types/index.js';

export class ScreenshotService {
  constructor(private readonly pdfService: PdfService) {}

  async capture(request: ScreenshotRequest): Promise<{ buffer: Buffer; mimeType: string }> {
    const format = request.format ?? 'png';
    const browser = await this.pdfService.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport(request.viewport ?? { width: 1280, height: 720 });

      if (request.url) {
        await page.goto(request.url, { waitUntil: 'networkidle0', timeout: 25_000 });
      } else {
        await page.setContent(request.html!, { waitUntil: 'networkidle0' });
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
