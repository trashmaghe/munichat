import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FilesService } from './files.service';
import { PrismaService } from '../prisma/prisma.service';

const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
  GetObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
  HeadObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
}));

const mockGetSignedUrl = jest.fn<Promise<string>, unknown[]>();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

describe('FilesService', () => {
  let service: FilesService;
  let prisma: { attachment: { findUnique: jest.Mock } };
  let configValues: Record<string, string>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = { attachment: { findUnique: jest.fn() } };
    configValues = {
      MINIO_ENDPOINT: 'localhost',
      MINIO_PORT: '9000',
      MINIO_USE_SSL: 'false',
      MINIO_ROOT_USER: 'munichat_admin',
      MINIO_ROOT_PASSWORD: 'munichat_dev_password',
      MINIO_BUCKET: 'munichat-files',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => configValues[key] },
        },
      ],
    }).compile();

    service = module.get(FilesService);
  });

  describe('presignUpload', () => {
    it('builds an objectKey scoped to the channel and returns the signed URL', async () => {
      mockGetSignedUrl.mockResolvedValue('https://minio.local/signed');

      const result = await service.presignUpload({
        channelId: 'channel-1',
        fileName: 'my report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      expect(result.uploadUrl).toBe('https://minio.local/signed');
      expect(result.objectKey).toMatch(
        /^attachments\/channel-1\/.+-my_report\.pdf$/,
      );
      expect(mockGetSignedUrl).toHaveBeenCalled();
    });
  });

  describe('getAttachmentForDownload', () => {
    it('includes the owning message channelId and deletedAt', async () => {
      prisma.attachment.findUnique.mockResolvedValue({ id: 'a1' });

      await service.getAttachmentForDownload('a1');

      expect(prisma.attachment.findUnique).toHaveBeenCalledWith({
        where: { id: 'a1' },
        include: { message: { select: { channelId: true, deletedAt: true } } },
      });
    });
  });

  describe('getRealObjectSize', () => {
    it('returns the ContentLength from a HeadObject response', async () => {
      mockS3Send.mockResolvedValue({ ContentLength: 2048 });

      const size = await service.getRealObjectSize('attachments/c1/x-file.png');

      expect(size).toBe(2048);
    });

    it('returns null when the object does not exist', async () => {
      mockS3Send.mockRejectedValue(new Error('NotFound'));

      const size = await service.getRealObjectSize(
        'attachments/c1/missing.png',
      );

      expect(size).toBeNull();
    });
  });
});
