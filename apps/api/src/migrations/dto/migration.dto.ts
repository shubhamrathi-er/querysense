import {
  IsString,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/** Optional source→target table rename (manual table mapping). */
export class TableMappingDto {
  @ApiProperty()
  @IsString()
  source!: string;

  @ApiProperty()
  @IsString()
  target!: string;
}

/** Request an AI/heuristic column-mapping suggestion for one table. */
export class SuggestColumnsDto {
  @ApiProperty()
  @IsString()
  sourceConnectionId!: string;

  @ApiProperty()
  @IsString()
  targetConnectionId!: string;

  @ApiProperty()
  @IsString()
  sourceTable!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  targetTable?: string;
}

/** One source→target column rename within a table (manual column mapping). */
export class ColumnMappingDto {
  @ApiProperty()
  @IsString()
  source!: string;

  @ApiProperty()
  @IsString()
  target!: string;
}

/** Per-table column map: only the listed source columns are copied. */
export class TableColumnMappingDto {
  @ApiProperty()
  @IsString()
  table!: string;

  @ApiProperty({ type: [ColumnMappingDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColumnMappingDto)
  columns!: ColumnMappingDto[];
}

/** Per-table list of source columns to create (ALTER ADD COLUMN) on the target. */
export class TableAddColumnsDto {
  @ApiProperty()
  @IsString()
  table!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  columns!: string[];
}

export class MigrationPlanDto {
  @ApiProperty()
  @IsString()
  sourceConnectionId!: string;

  @ApiProperty()
  @IsString()
  targetConnectionId!: string;
}

export class ValidateMigrationDto {
  @ApiProperty()
  @IsString()
  sourceConnectionId!: string;

  @ApiProperty()
  @IsString()
  targetConnectionId!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  tables!: string[];

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  allowViews?: boolean;

  @ApiProperty({ enum: ['append', 'overwrite'], required: false })
  @IsOptional()
  @IsIn(['append', 'overwrite'])
  mode?: 'append' | 'overwrite';

  @ApiProperty({ type: [TableMappingDto], required: false, description: 'Per-table source→target rename' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableMappingDto)
  tableMappings?: TableMappingDto[];
}

export class MigrationRunDto {
  @ApiProperty()
  @IsString()
  sourceConnectionId!: string;

  @ApiProperty()
  @IsString()
  targetConnectionId!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  tables!: string[];

  @ApiProperty({ default: true })
  @IsOptional()
  @IsBoolean()
  createTables?: boolean;

  @ApiProperty({ enum: ['skip', 'truncate', 'upsert'], default: 'skip' })
  @IsOptional()
  @IsIn(['skip', 'truncate', 'upsert'])
  conflict?: 'skip' | 'truncate' | 'upsert';

  @ApiProperty({ required: false, default: false, description: 'Skip the pre-flight validation gate' })
  @IsOptional()
  @IsBoolean()
  skipValidation?: boolean;

  @ApiProperty({ required: false, default: true, description: 'Auto-create source columns missing on existing target tables (unless the table is explicitly column-mapped)' })
  @IsOptional()
  @IsBoolean()
  createMissingColumns?: boolean;

  @ApiProperty({ type: [TableMappingDto], required: false, description: 'Per-table source→target rename' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableMappingDto)
  tableMappings?: TableMappingDto[];

  @ApiProperty({ type: [TableColumnMappingDto], required: false, description: 'Per-table column map (only listed columns are copied)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableColumnMappingDto)
  columnMappings?: TableColumnMappingDto[];

  @ApiProperty({ type: [TableAddColumnsDto], required: false, description: 'Per-table source columns to create on the target (ALTER ADD COLUMN) before copy' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableAddColumnsDto)
  addColumns?: TableAddColumnsDto[];
}
