import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateDescriptionDto {
  @ApiProperty({ example: 'Stores customer shipping addresses.' })
  @IsString()
  @MaxLength(2000)
  description!: string;
}
