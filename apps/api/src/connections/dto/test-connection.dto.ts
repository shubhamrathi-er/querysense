import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TestConnectionDto {
  @ApiProperty({ example: 'localhost' })
  @IsString()
  host!: string;

  @ApiProperty({ example: 3306 })
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @ApiProperty({ example: 'myapp_db' })
  @IsString()
  databaseName!: string;

  @ApiProperty({ example: 'root' })
  @IsString()
  username!: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  password!: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  sslEnabled?: boolean;

  // ── SSH tunnel (optional) ──
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  sshEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sshHost?: string;

  @ApiProperty({ required: false, default: 22 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sshUsername?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sshPassword?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sshPrivateKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sshPassphrase?: string;
}
