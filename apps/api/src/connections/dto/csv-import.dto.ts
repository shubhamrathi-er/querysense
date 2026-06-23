import {
  IsString,
  IsIn,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * One mapping entry: a CSV header → target DB column.
 * `dbType` is only used when creating a new table.
 */
export class CsvColumnMappingDto {
  @ApiProperty({ example: 'Email Address', description: 'Header in the CSV file' })
  @IsString()
  csvColumn!: string;

  @ApiProperty({ example: 'email', description: 'Target column in the DB table' })
  @IsString()
  dbColumn!: string;

  @ApiProperty({
    required: false,
    example: 'VARCHAR(255)',
    description: 'MySQL type — required for new tables, ignored for existing',
  })
  @IsOptional()
  @IsString()
  dbType?: string;
}

export class CsvImportDto {
  @ApiProperty({ example: 'clx123abc' })
  @IsString()
  connectionId!: string;

  @ApiProperty({ enum: ['existing', 'new'], example: 'new' })
  @IsIn(['existing', 'new'])
  mode!: 'existing' | 'new';

  @ApiProperty({ example: 'customers' })
  @IsString()
  tableName!: string;

  @ApiProperty({ type: [CsvColumnMappingDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CsvColumnMappingDto)
  columns!: CsvColumnMappingDto[];

  @ApiProperty({
    required: false,
    type: [String],
    description:
      'DB columns that uniquely identify a row. When set (existing tables), ' +
      'rows whose key already exists in the table — or earlier in the file — are skipped.',
    example: ['email'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  uniqueKeys?: string[];

  @ApiProperty({
    description: 'Parsed CSV rows keyed by CSV header',
    example: [{ 'Email Address': 'a@b.com', Name: 'Alice' }],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50000)
  rows!: Record<string, string | null>[];
}
