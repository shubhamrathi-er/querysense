/**
 * Fail-fast validation of security-critical environment variables.
 *
 * A missing or placeholder secret is a silent disaster: AES-at-rest and JWT
 * signing would run on a guessable key, and tokens/ciphertext from one
 * environment would verify in another. We refuse to boot rather than start
 * insecure.
 */

// Known weak/placeholder values that must never reach production.
const PLACEHOLDERS = new Set([
  'fallback-key-change-in-prod',
  'change-in-prod',
  'changeme',
  'change-me',
  'secret',
  'jwtsecret',
  'jwt-secret',
  'your-secret',
  'your-secret-key',
  'dev',
  'development',
  'test',
  'password',
]);

interface SecretRule {
  name: string;
  minLength: number;
}

const REQUIRED_SECRETS: SecretRule[] = [
  { name: 'JWT_SECRET', minLength: 32 },
  { name: 'JWT_REFRESH_SECRET', minLength: 32 },
  { name: 'ENCRYPTION_KEY', minLength: 16 },
];

const REQUIRED_PRESENT = ['DATABASE_URL'];

export function validateEnv(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const errors: string[] = [];

  for (const key of REQUIRED_PRESENT) {
    if (!env[key]?.trim()) errors.push(`${key} is required but not set`);
  }

  for (const { name, minLength } of REQUIRED_SECRETS) {
    const value = env[name]?.trim();
    if (!value) {
      errors.push(`${name} is required but not set`);
      continue;
    }
    if (PLACEHOLDERS.has(value.toLowerCase())) {
      errors.push(`${name} is set to a known placeholder value — use a real secret`);
      continue;
    }
    if (value.length < minLength) {
      errors.push(
        `${name} is too short (${value.length} chars); needs at least ${minLength}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Refusing to start — insecure configuration:\n  - ${errors.join('\n  - ')}`,
    );
  }
}
