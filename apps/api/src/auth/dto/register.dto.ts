import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SanitizeText, TrimText } from '../../common/validation/sanitize';

export class RegisterDto {
  @ApiProperty({ example: 'john@example.com' })
  @TrimText()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // Sanitised (HTML/script/control chars stripped) before length validation.
  @ApiProperty({ example: 'John Doe' })
  @SanitizeText()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name!: string;

  // Passwords are NOT sanitised — special characters are desirable and stripping
  // them would weaken credentials. Only length is bounded.
  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;
}
