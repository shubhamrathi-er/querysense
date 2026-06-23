import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChooseInterpretationDto {
  @ApiProperty({ description: 'The SQL of the chosen interpretation' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  sql!: string;
}
