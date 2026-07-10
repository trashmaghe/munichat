import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';

export function createS3Client(configService: ConfigService): S3Client {
  const endpoint = configService.get<string>('MINIO_ENDPOINT')!;
  const port = configService.get<string>('MINIO_PORT')!;
  const useSsl = configService.get<string>('MINIO_USE_SSL') === 'true';

  return new S3Client({
    endpoint: `${useSsl ? 'https' : 'http'}://${endpoint}:${port}`,
    forcePathStyle: true,
    region: 'us-east-1',
    credentials: {
      accessKeyId: configService.get<string>('MINIO_ROOT_USER')!,
      secretAccessKey: configService.get<string>('MINIO_ROOT_PASSWORD')!,
    },
  });
}
