import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImportRecordDto {
  @ApiProperty({ example: 'Imported "customers.csv"' })
  @IsString()
  @MaxLength(2000)
  userContent!: string;

  @ApiProperty({ example: 'Created table `customers` and inserted 1,200 rows.' })
  @IsString()
  @MaxLength(2000)
  assistantContent!: string;
}
