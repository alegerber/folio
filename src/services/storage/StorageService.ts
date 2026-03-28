import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { env } from '../../config/env.js';

export class StorageService {
  constructor(private readonly s3: S3Client) {}

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
      this.s3,
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      }),
      { expiresIn: env.SIGNED_URL_EXPIRY_SECONDS },
    );

    return url;
  }
}
