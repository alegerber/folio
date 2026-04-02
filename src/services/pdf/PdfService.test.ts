import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PdfService } from './PdfService.js';

const mockPdf = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock'));
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockSetContent = vi.fn().mockResolvedValue(undefined);
const mockAddStyleTag = vi.fn().mockResolvedValue(undefined);
const mockNewPage = vi.fn().mockResolvedValue({
  setContent: mockSetContent,
  addStyleTag: mockAddStyleTag,
  pdf: mockPdf,
  close: mockClose,
});
const mockBrowserClose = vi.fn().mockResolvedValue(undefined);
const mockLaunch = vi.fn().mockResolvedValue({
  newPage: mockNewPage,
  close: mockBrowserClose,
});

vi.mock('puppeteer-core', () => ({
  default: {
    launch: mockLaunch,
  },
}));

vi.mock('@sparticuz/chromium', () => ({
  default: {
    args: ['--no-sandbox'],
    executablePath: vi.fn().mockResolvedValue('/usr/bin/chromium'),
    headless: true,
  },
}));

describe('PdfService', () => {
  let pdfService: PdfService;

  beforeEach(() => {
    vi.clearAllMocks();
    pdfService = new PdfService();
  });

  it('generates a PDF from HTML', async () => {
    const html = '<html><body><h1>Hello World</h1></body></html>';

    const result = await pdfService.generate(html);

    expect(mockSetContent).toHaveBeenCalledWith(html, { waitUntil: 'networkidle0' });
    expect(mockAddStyleTag).not.toHaveBeenCalled();
    expect(mockPdf).toHaveBeenCalledOnce();
    expect(result).toBeInstanceOf(Buffer);
  });

  it('injects CSS via addStyleTag when css is provided', async () => {
    const html = '<html><body><h1>Hello</h1></body></html>';
    const css = 'body { font-size: 14px; }';

    await pdfService.generate(html, css);

    expect(mockSetContent).toHaveBeenCalledWith(html, { waitUntil: 'networkidle0' });
    expect(mockAddStyleTag).toHaveBeenCalledWith({ content: css });
  });

  it('does not call addStyleTag when css is not provided', async () => {
    await pdfService.generate('<html></html>');

    expect(mockAddStyleTag).not.toHaveBeenCalled();
  });

  it('applies paper size options', async () => {
    const html = '<html><body></body></html>';

    await pdfService.generate(html, undefined, { size: 'A4', orientation: 'portrait' });

    const pdfCall = mockPdf.mock.calls[0][0];
    expect(pdfCall).toMatchObject({ width: '210mm', height: '297mm' });
  });

  it('applies landscape orientation by swapping dimensions', async () => {
    const html = '<html><body></body></html>';

    await pdfService.generate(html, undefined, { size: 'A4', orientation: 'landscape' });

    const pdfCall = mockPdf.mock.calls[0][0];
    expect(pdfCall).toMatchObject({ width: '297mm', height: '210mm' });
  });

  it('applies PDF options', async () => {
    const html = '<html><body></body></html>';

    await pdfService.generate(
      html,
      undefined,
      undefined,
      {
        printBackground: true,
        scale: 0.8,
        margin: { top: '10mm', bottom: '10mm', left: '15mm', right: '15mm' },
      },
    );

    const pdfCall = mockPdf.mock.calls[0][0];
    expect(pdfCall).toMatchObject({
      printBackground: true,
      scale: 0.8,
      margin: { top: '10mm', bottom: '10mm', left: '15mm', right: '15mm' },
    });
  });

  it('closes the page after generation even on error', async () => {
    mockSetContent.mockRejectedValueOnce(new Error('Page load failed'));

    await expect(pdfService.generate('<html></html>')).rejects.toThrow('Page load failed');
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it('reuses the browser across multiple calls', async () => {
    const html = '<html><body></body></html>';

    await pdfService.generate(html);
    await pdfService.generate(html);

    expect(mockLaunch).toHaveBeenCalledOnce();
  });

  it('closes the browser on close()', async () => {
    await pdfService.generate('<html></html>');
    await pdfService.close();

    expect(mockBrowserClose).toHaveBeenCalledOnce();
  });

  it('retries browser launch after an initial launch failure', async () => {
    mockLaunch
      .mockRejectedValueOnce(new Error('Chromium failed to start'))
      .mockResolvedValueOnce({
        newPage: mockNewPage,
        close: mockBrowserClose,
      });

    await expect(pdfService.generate('<html></html>')).rejects.toThrow('Chromium failed to start');
    await expect(pdfService.generate('<html></html>')).resolves.toBeInstanceOf(Buffer);
    expect(mockLaunch).toHaveBeenCalledTimes(2);
  });
});
