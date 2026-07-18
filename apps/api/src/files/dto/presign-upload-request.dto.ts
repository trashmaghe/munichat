import {
  IsIn,
  IsInt,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_SIZE_BYTES,
} from '@elyzian/shared';

export class PresignUploadRequestDto {
  @IsString()
  channelId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsIn(ALLOWED_UPLOAD_MIME_TYPES)
  mimeType!: (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];

  @IsInt()
  @IsPositive()
  @Max(MAX_UPLOAD_SIZE_BYTES)
  sizeBytes!: number;
}
