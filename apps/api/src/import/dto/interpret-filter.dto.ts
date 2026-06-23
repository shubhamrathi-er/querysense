import { IsString, IsArray, MaxLength, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InterpretFilterDto {
  @ApiProperty({ type: [String], example: ['id', 'status', 'amount'] })
  @IsArray()
  @IsString({ each: true })
  columns!: string[];

  @ApiProperty({ description: 'A few sample rows to help interpret the instruction' })
  @IsArray()
  @ArrayMaxSize(50)
  sampleRows!: Record<string, string | null>[];

  @ApiProperty({ example: 'only import rows where status is approved' })
  @IsString()
  @MaxLength(2000)
  instruction!: string;
}
