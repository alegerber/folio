export interface PaperOptions {
  size?: string;
  orientation?: 'portrait' | 'landscape';
}

export interface MarginOptions {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export interface PdfOptions {
  margin?: MarginOptions;
  scale?: number;
  printBackground?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
}

export interface CookieParam {
  name: string;
  value: string;
  domain: string;
}

export interface ScreenshotRequest {
  html?: string;
  url?: string;
  css?: string;
  viewport?: { width: number; height: number };
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
  stream?: boolean;
}
