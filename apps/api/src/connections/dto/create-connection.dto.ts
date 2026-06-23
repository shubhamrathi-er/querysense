import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  IsIn,
  MinLength,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DB_ENGINES } from '../../common/db/engine';
import type { DbEngine } from '../../common/db/engine';

export class CreateConnectionDto {
  @ApiProperty({ example: 'Production DB' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name!: string;

  @ApiProperty({
    enum: DB_ENGINES,
    default: 'mysql',
    required: false,
    description: 'Target database engine',
  })
  @IsOptional()
  @IsIn(DB_ENGINES)
  engine?: DbEngine;

  @ApiProperty({ example: 'localhost' })
  @IsString()
  host!: string;

  @ApiProperty({
    required: false,
    example: 3306,
    description: 'Defaults to the engine standard port (3306 mysql / 5432 postgres)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

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

  @ApiProperty({ required: false, example: 'bastion.example.com' })
  @IsOptional()
  @IsString()
  sshHost?: string;

  @ApiProperty({ required: false, default: 22 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort?: number;

  @ApiProperty({ required: false, example: 'ec2-user' })
  @IsOptional()
  @IsString()
  sshUsername?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sshPassword?: string;

  @ApiProperty({ required: false, description: 'PEM private key contents' })
  @IsOptional()
  @IsString()
  sshPrivateKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sshPassphrase?: string;
}
