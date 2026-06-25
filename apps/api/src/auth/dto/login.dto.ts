import { IsEmail, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TrimText } from '../../common/validation/sanitize';

export class LoginDto {
  @ApiProperty({ example: 'john@example.com' })
  @TrimText()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MaxLength(100)
  password!: string;
}
