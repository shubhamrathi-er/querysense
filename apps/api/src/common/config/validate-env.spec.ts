import { validateEnv } from './validate-env';

const ok = {
  DATABASE_URL: 'mysql://u:p@localhost:3306/db',
  JWT_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  ENCRYPTION_KEY: 'c'.repeat(20),
} as NodeJS.ProcessEnv;

describe('validateEnv', () => {
  it('passes with strong secrets', () => {
    expect(() => validateEnv(ok)).not.toThrow();
  });

  it('throws when a required secret is missing', () => {
    const env = { ...ok, JWT_SECRET: undefined };
    expect(() => validateEnv(env)).toThrow(/JWT_SECRET is required/);
  });

  it('throws when DATABASE_URL is missing', () => {
    const env = { ...ok, DATABASE_URL: '' };
    expect(() => validateEnv(env)).toThrow(/DATABASE_URL is required/);
  });

  it('rejects known placeholder values', () => {
    const env = { ...ok, JWT_SECRET: 'changeme' };
    expect(() => validateEnv(env)).toThrow(/placeholder/);
  });

  it('rejects the old encryption fallback key', () => {
    const env = { ...ok, ENCRYPTION_KEY: 'fallback-key-change-in-prod' };
    expect(() => validateEnv(env)).toThrow(/placeholder/);
  });

  it('rejects secrets that are too short', () => {
    const env = { ...ok, JWT_SECRET: 'short' };
    expect(() => validateEnv(env)).toThrow(/too short/);
  });
});
