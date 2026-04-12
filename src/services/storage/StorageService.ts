import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { env } from '../../config/env.js';

export interface StoredPdf {
  id: string;
  url: string;
}

export class PdfNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(id: string) {
    super(`PDF not found: ${id}`);
    this.name = 'PdfNotFoundError';
  }
}

function isS3NotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  return err.name === 'NoSuchKey' || err.name === 'NotFound';
}

export class StorageService {
  // s3 is used for uploads; s3Public is used for presigning so the returned
  // URL contains the publicly reachable host instead of the internal one.
  constructor(
    private readonly s3: S3Client,
    private readonly s3Public: S3Client,
  ) {}

  private keyFromId(id: string): string {
    return `pdfs/${id}.pdf`;
  }

  private async assertExists(id: string): Promise<void> {
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: this.keyFromId(id) }),
      );
    } catch (err) {
      if (isS3NotFoundError(err)) {
        throw new PdfNotFoundError(id);
      }

      throw err;
    }
  }

  async getUrl(id: string): Promise<string> {
    await this.assertExists(id);

    return getSignedUrl(
      this.s3Public,
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: this.keyFromId(id) }),
      { expiresIn: env.SIGNED_URL_EXPIRY_SECONDS },
    );
  }

  async delete(id: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: this.keyFromId(id) }),
    );
  }

  async download(id: string): Promise<Buffer> {
    let response;
    try {
      response = await this.s3.send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: this.keyFromId(id) }),
      );
    } catch (err) {
      if (isS3NotFoundError(err)) {
        throw new PdfNotFoundError(id);
      }

      throw err;
    }

    if (!response.Body) {
      throw new PdfNotFoundError(id);
    }

    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async upload(pdfBuffer: Buffer): Promise<StoredPdf> {
    const id = randomUUID();
    const key = this.keyFromId(id);

    await this.s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      }),
    );

    const url = await getSignedUrl(
      this.s3Public,
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      }),
      { expiresIn: env.SIGNED_URL_EXPIRY_SECONDS },
    );

    return { id, url };
  }

  async uploadImage(buffer: Buffer, format: string, contentType: string): Promise<StoredPdf> {
    const id = randomUUID();
    const key = `screenshots/${id}.${format}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    const url = await getSignedUrl(
      this.s3Public,
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      }),
      { expiresIn: env.SIGNED_URL_EXPIRY_SECONDS },
    );

    return { id, url };
  }
}
