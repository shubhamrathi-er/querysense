import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshDto {
  @ApiProperty({ description: 'A valid refresh token issued at login.' })
  @IsString()
  refreshToken!: string;
}
