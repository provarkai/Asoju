import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class RequestUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  // Broad but not wide open — enough to reject someone pasting arbitrary
  // text into this field, without hand-maintaining an allowed-type list
  // that just goes stale as evidence/document types grow.
  @IsString()
  @Matches(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i, { message: 'contentType must look like a MIME type, e.g. image/jpeg' })
  contentType: string;
}
