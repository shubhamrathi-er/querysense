import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExecuteSqlDto {
  @ApiProperty({ example: 'SELECT COUNT(*) FROM users' })
  @IsString()
  sql!: string;

  @ApiProperty({ example: 'clx123abc' })
  @IsString()
  connectionId!: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
