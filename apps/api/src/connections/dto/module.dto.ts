import { IsString, IsOptional, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateModuleDto {
  @ApiProperty({ example: 'Orders' })
  @IsString()
  @MaxLength(100)
  name!: string;
}

export class UpdateModuleDto {
  @ApiProperty({ required: false, example: 'Orders' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false, example: 'Everything about customer orders.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class AssignModuleDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Target module id, or null to ungroup the table',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  moduleId!: string | null;
}
