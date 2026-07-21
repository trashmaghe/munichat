import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';

function credentials(configService: ConfigService) {
  return {
    accessKeyId: configService.get<string>('MINIO_ROOT_USER')!,
    secretAccessKey: configService.get<string>('MINIO_ROOT_PASSWORD')!,
  };
}

// For server-to-server calls (GetObject/HeadObject/PutObject made by the API
// itself) - uses the internal Docker-network endpoint, only resolvable
// container-to-container.
export function createS3Client(configService: ConfigService): S3Client {
  const endpoint = configService.get<string>('MINIO_ENDPOINT')!;
  const port = configService.get<string>('MINIO_PORT')!;
  const useSsl = configService.get<string>('MINIO_USE_SSL') === 'true';

  return new S3Client({
    endpoint: `${useSsl ? 'https' : 'http'}://${endpoint}:${port}`,
    forcePathStyle: true,
    region: 'us-east-1',
    credentials: credentials(configService),
  });
}

// For presigned URLs the browser will call directly (uploads) - must use a
// host the browser can actually resolve, which the internal `minio` Docker
// hostname is not. Falls back to the internal client when
// MINIO_PUBLIC_ENDPOINT isn't set (e.g. an older .env from before this
// existed), same as it always behaved - better to keep working for
// server-to-server calls than to throw on startup.
export function createPresignS3Client(configService: ConfigService): S3Client {
  const publicEndpoint = configService.get<string>('MINIO_PUBLIC_ENDPOINT');
  if (!publicEndpoint) {
    return createS3Client(configService);
  }

  return new S3Client({
    endpoint: publicEndpoint,
    forcePathStyle: true,
    region: 'us-east-1',
    credentials: credentials(configService),
  });
}
