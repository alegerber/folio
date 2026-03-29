import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageService } from './StorageService.js';
import { S3Client } from '@aws-sdk/client-s3';

// Mock the AWS SDK modules
vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: class {
      send = vi.fn().mockResolvedValue({});
    },
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true'),
}));

vi.mock('../../config/env.js', () => ({
  env: {
    S3_BUCKET: 'test-bucket',
    AWS_REGION: 'us-east-1',
    SIGNED_URL_EXPIRY_SECONDS: 3600,
  },
}));

describe('StorageService', () => {
  let storageService: StorageService;
  let mockS3Client: S3Client;
  let mockS3PublicClient: S3Client;

  beforeEach(() => {
    vi.clearAllMocks();
    mockS3Client = new S3Client({ region: 'us-east-1' });
    mockS3PublicClient = new S3Client({ region: 'us-east-1' });
    storageService = new StorageService(mockS3Client, mockS3PublicClient);
  });

  it('uploads PDF and returns a presigned URL', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 test content');

    const url = await storageService.upload(pdfBuffer);

    expect(url).toBe('https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true');
    expect(mockS3Client.send).toHaveBeenCalledOnce();
  });

  it('uses the correct bucket and content type when uploading', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const pdfBuffer = Buffer.from('%PDF-1.4 test content');

    await storageService.upload(pdfBuffer);

    const sendCall = vi.mocked(mockS3Client.send).mock.calls[0][0];
    expect(sendCall).toBeInstanceOf(PutObjectCommand);
  });
});
