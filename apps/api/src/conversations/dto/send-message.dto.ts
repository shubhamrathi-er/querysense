import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ example: 'Show me the top 5 tables by row count' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @ApiProperty({ example: 'clx123abc' })
  @IsString()
  connectionId!: string;
}
