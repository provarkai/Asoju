import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ConversationTurnDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  content: string;
}

export class ConciergeMessageDto {
  @IsString()
  @MinLength(1)
  message: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ConversationTurnDto)
  history?: ConversationTurnDto[];
}
