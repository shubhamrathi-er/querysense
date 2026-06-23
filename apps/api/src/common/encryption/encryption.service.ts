import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as CryptoJS from 'crypto-js';

@Injectable()
export class EncryptionService {
  private readonly key: string;

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('ENCRYPTION_KEY')?.trim();
    // No silent fallback — a guessable key would expose every secret at rest.
    if (!key || key.length < 16) {
      throw new Error(
        'ENCRYPTION_KEY is missing or too short (need ≥16 chars). Refusing to start.',
      );
    }
    this.key = key;
  }

  encrypt(text: string): string {
    return CryptoJS.AES.encrypt(text, this.key).toString();
  }

  decrypt(cipherText: string): string {
    const bytes = CryptoJS.AES.decrypt(cipherText, this.key);
    return bytes.toString(CryptoJS.enc.Utf8);
  }
}
