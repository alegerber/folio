import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScreenshotService } from './ScreenshotService.js';
import type { PdfService } from '../pdf/PdfService.js';

const mockScreenshot = vi.fn().mockResolvedValue(Buffer.from('PNG_DATA'));
const mockPageClose = vi.fn().mockResolvedValue(undefined);
const mockSetContent = vi.fn().mockResolvedValue(undefined);
const mockGoto = vi.fn().mockResolvedValue(undefined);
const mockAddStyleTag = vi.fn().mockResolvedValue(undefined);
const mockSetViewport = vi.fn().mockResolvedValue(undefined);

const mockNewPage = vi.fn().mockResolvedValue({
  setViewport: mockSetViewport,
  setContent: mockSetContent,
  goto: mockGoto,
  addStyleTag: mockAddStyleTag,
  screenshot: mockScreenshot,
  close: mockPageClose,
});

const mockBrowser = { newPage: mockNewPage };
const mockGetBrowser = vi.fn().mockResolvedValue(mockBrowser);
const mockPdfService = { getBrowser: mockGetBrowser } as unknown as PdfService;

describe('ScreenshotService', () => {
  let screenshotService: ScreenshotService;

  beforeEach(() => {
    vi.clearAllMocks();
    screenshotService = new ScreenshotService(mockPdfService);
  });

  it('captures a PNG screenshot from HTML', async () => {
    const { buffer, mimeType } = await screenshotService.capture({
      html: '<html><body>Hello</body></html>',
    });

    expect(mockSetContent).toHaveBeenCalledWith('<html><body>Hello</body></html>', {
      waitUntil: 'networkidle0',
    });
    expect(mockGoto).not.toHaveBeenCalled();
    expect(mockScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'png', fullPage: false }),
    );
    expect(mimeType).toBe('image/png');
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('navigates to a URL when url is provided', async () => {
    await screenshotService.capture({ url: 'https://example.com' });

    expect(mockGoto).toHaveBeenCalledWith('https://example.com', {
      waitUntil: 'networkidle0',
      timeout: 25_000,
    });
    expect(mockSetContent).not.toHaveBeenCalled();
  });

  it('injects CSS when css is provided', async () => {
    await screenshotService.capture({
      html: '<html></html>',
      css: 'body { background: red; }',
    });

    expect(mockAddStyleTag).toHaveBeenCalledWith({ content: 'body { background: red; }' });
  });

  it('does not call addStyleTag when css is not provided', async () => {
    await screenshotService.capture({ html: '<html></html>' });

    expect(mockAddStyleTag).not.toHaveBeenCalled();
  });

  it('uses custom viewport when provided', async () => {
    await screenshotService.capture({
      html: '<html></html>',
      viewport: { width: 800, height: 600 },
    });

    expect(mockSetViewport).toHaveBeenCalledWith({ width: 800, height: 600 });
  });

  it('defaults to 1280x720 viewport', async () => {
    await screenshotService.capture({ html: '<html></html>' });

    expect(mockSetViewport).toHaveBeenCalledWith({ width: 1280, height: 720 });
  });

  it('captures JPEG with quality', async () => {
    const { mimeType } = await screenshotService.capture({
      html: '<html></html>',
      format: 'jpeg',
      quality: 80,
    });

    expect(mockScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'jpeg', quality: 80 }),
    );
    expect(mimeType).toBe('image/jpeg');
  });

  it('ignores quality for PNG', async () => {
    await screenshotService.capture({
      html: '<html></html>',
      format: 'png',
      quality: 80,
    });

    const screenshotCall = mockScreenshot.mock.calls[0][0];
    expect(screenshotCall.quality).toBeUndefined();
  });

  it('captures full page when fullPage is true', async () => {
    await screenshotService.capture({ html: '<html></html>', fullPage: true });

    expect(mockScreenshot).toHaveBeenCalledWith(expect.objectContaining({ fullPage: true }));
  });

  it('applies clip region when provided', async () => {
    const clip = { x: 0, y: 0, width: 400, height: 300 };

    await screenshotService.capture({ html: '<html></html>', clip });

    expect(mockScreenshot).toHaveBeenCalledWith(expect.objectContaining({ clip }));
  });

  it('closes the page after capture even on error', async () => {
    mockSetContent.mockRejectedValueOnce(new Error('Load failed'));

    await expect(
      screenshotService.capture({ html: '<html></html>' }),
    ).rejects.toThrow('Load failed');

    expect(mockPageClose).toHaveBeenCalledOnce();
  });

  it('reuses the browser from PdfService', async () => {
    await screenshotService.capture({ html: '<html></html>' });
    await screenshotService.capture({ html: '<html></html>' });

    expect(mockGetBrowser).toHaveBeenCalledTimes(2);
    expect(mockNewPage).toHaveBeenCalledTimes(2);
  });
});
