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

export interface GenerateRequest {
  html: string;
  css?: string;
  paper?: PaperOptions;
  options?: PdfOptions;
  stream?: boolean;
}

export interface GenerateResponse {
  statusCode: number;
  data: {
    url: string;
  };
}
