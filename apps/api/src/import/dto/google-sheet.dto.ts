import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleSheetDto {
  @ApiProperty({
    example: 'https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0',
    description: 'Link to a Google Sheet shared as "Anyone with the link → Viewer"',
  })
  @IsString()
  url!: string;
}
