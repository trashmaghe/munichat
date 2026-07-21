import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Attachment } from '@prisma/client';
import { PresignUploadResponse } from '@elyzian/shared';
import { PrismaService } from '../prisma/prisma.service';
import { createPresignS3Client, createS3Client } from './files.s3-client';

const PRESIGN_EXPIRY_SECONDS = 300;

export interface PresignUploadInput {
  channelId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export type AttachmentForDownload = Attachment & {
  message: { channelId: string; deletedAt: Date | null };
};

@Injectable()
export class FilesService {
  private readonly s3: S3Client;
  private readonly presignS3: S3Client;
  private readonly bucket: string;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.s3 = createS3Client(configService);
    this.presignS3 = createPresignS3Client(configService);
    this.bucket = configService.get<string>('MINIO_BUCKET')!;
  }

  async presignUpload(
    input: PresignUploadInput,
  ): Promise<PresignUploadResponse> {
    const objectKey = `attachments/${input.channelId}/${randomUUID()}-${this.sanitizeFileName(input.fileName)}`;

    const uploadUrl = await getSignedUrl(
      this.presignS3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: input.mimeType,
      }),
      { expiresIn: PRESIGN_EXPIRY_SECONDS },
    );

    const expiresAt = new Date(
      Date.now() + PRESIGN_EXPIRY_SECONDS * 1000,
    ).toISOString();

    return { uploadUrl, objectKey, expiresAt };
  }

  async getAttachmentForDownload(
    id: string,
  ): Promise<AttachmentForDownload | null> {
    return this.prisma.attachment.findUnique({
      where: { id },
      include: { message: { select: { channelId: true, deletedAt: true } } },
    });
  }

  async streamObject(objectKey: string): Promise<Readable> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    return response.Body as Readable;
  }

  // Streams a byte range of an object (for HTTP Range requests, e.g. video
  // seeking). `start`/`end` are inclusive byte offsets. MinIO/S3 GetObject
  // honours the Range header and returns just that window.
  async streamObjectRange(
    objectKey: string,
    start: number,
    end: number,
  ): Promise<Readable> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Range: `bytes=${start}-${end}`,
      }),
    );
    return response.Body as Readable;
  }

  async getRealObjectSize(objectKey: string): Promise<number | null> {
    try {
      const response = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return response.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  }
}
