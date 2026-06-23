import { IsOptional, IsInt, IsString, IsIn, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryHistoryQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  connectionId?: string;

  @ApiPropertyOptional({ enum: ['SUCCESS', 'ERROR', 'TIMEOUT'] })
  @IsOptional()
  @IsIn(['SUCCESS', 'ERROR', 'TIMEOUT'])
  status?: 'SUCCESS' | 'ERROR' | 'TIMEOUT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
