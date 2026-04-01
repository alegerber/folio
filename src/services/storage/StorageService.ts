import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { env } from '../../config/env.js';

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

  async getUrl(id: string): Promise<string> {
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
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: this.keyFromId(id) }),
    );
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async upload(pdfBuffer: Buffer): Promise<string> {
    const key = `pdfs/${randomUUID()}.pdf`;

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

    return url;
  }
}
