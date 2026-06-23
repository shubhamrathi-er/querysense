import {
  IsString,
  IsEnum,
  IsOptional,
  IsObject,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WidgetType } from '@prisma/client';

export class CreateWidgetDto {
  @ApiProperty({ example: 'Total Users' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty({ enum: WidgetType })
  @IsEnum(WidgetType)
  widgetType!: WidgetType;

  @ApiProperty({ example: 'SELECT COUNT(*) as total FROM users' })
  @IsString()
  sql!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  chartConfig?: Record<string, unknown>;

  @ApiProperty({ example: { x: 0, y: 0, w: 4, h: 3 } })
  @IsObject()
  position!: Record<string, number>;

  @ApiProperty({ required: false })
  @IsOptional()
  connectionId!: string;
}
