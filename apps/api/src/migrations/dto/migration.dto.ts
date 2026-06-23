import {
  IsString,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
