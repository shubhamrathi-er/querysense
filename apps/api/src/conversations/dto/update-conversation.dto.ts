import { IsString, IsBoolean, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateConversationDto {
  @ApiProperty({ required: false, example: 'Revenue analysis' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}
