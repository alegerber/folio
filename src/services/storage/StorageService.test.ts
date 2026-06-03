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

    const storedPdf = await storageService.upload(pdfBuffer);

    expect(storedPdf).toMatchObject({
      id: expect.any(String),
      url: 'https://s3.amazonaws.com/test-bucket/pdfs/test.pdf?signed=true',
    });
    expect(mockS3Client.send).toHaveBeenCalledOnce();
  });

  it('uses the correct bucket and content type when uploading', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const pdfBuffer = Buffer.from('%PDF-1.4 test content');

    await storageService.upload(pdfBuffer);

    const sendCall = vi.mocked(mockS3Client.send).mock.calls[0][0];
    expect(sendCall).toBeInstanceOf(PutObjectCommand);
  });

  it('checks that a PDF exists before presigning its URL', async () => {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');

    await storageService.getUrl('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

    const sendCall = vi.mocked(mockS3Client.send).mock.calls[0][0];
    expect(sendCall).toBeInstanceOf(HeadObjectCommand);
  });

  it('throws a not found error when the PDF does not exist', async () => {
    const notFoundError = Object.assign(new Error('missing'), { name: 'NotFound' });
    vi.mocked(mockS3Client.send).mockRejectedValueOnce(notFoundError);

    await expect(storageService.getUrl('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).rejects.toThrow(
      'PDF not found',
    );
  });

  it('propagates non-404 S3 errors from getUrl instead of masking them as not-found', async () => {
    const accessDenied = Object.assign(new Error('denied'), { name: 'AccessDenied' });
    vi.mocked(mockS3Client.send).mockRejectedValueOnce(accessDenied);

    await expect(storageService.getUrl('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).rejects.toThrow('denied');
  });

  it('uploads an image and returns a presigned URL', async () => {
    const stored = await storageService.uploadImage(Buffer.from('PNG'), 'png', 'image/png');

    expect(stored).toMatchObject({ id: expect.any(String), url: expect.stringContaining('https://') });
    expect(mockS3Client.send).toHaveBeenCalledOnce();
  });

  it('propagates S3 errors when uploadImage fails', async () => {
    vi.mocked(mockS3Client.send).mockRejectedValueOnce(new Error('S3 upload failed'));

    await expect(
      storageService.uploadImage(Buffer.from('PNG'), 'png', 'image/png'),
    ).rejects.toThrow('S3 upload failed');
  });

  it('propagates S3 errors when upload fails', async () => {
    vi.mocked(mockS3Client.send).mockRejectedValueOnce(new Error('PutObject failed'));

    await expect(storageService.upload(Buffer.from('%PDF-1.4'))).rejects.toThrow('PutObject failed');
  });

  it('throws not found when downloading a missing object', async () => {
    const noSuchKey = Object.assign(new Error('no key'), { name: 'NoSuchKey' });
    vi.mocked(mockS3Client.send).mockRejectedValueOnce(noSuchKey);

    await expect(storageService.download('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).rejects.toThrow(
      'PDF not found',
    );
  });
});
