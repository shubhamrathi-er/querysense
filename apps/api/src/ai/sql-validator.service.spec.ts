import { SqlValidatorService } from './sql-validator.service';

describe('SqlValidatorService.validate (fail-closed)', () => {
  const validator = new SqlValidatorService();

  it('accepts a normal SELECT', () => {
    expect(validator.validate('SELECT id FROM users').valid).toBe(true);
  });

  it('rejects forbidden operations', () => {
    expect(validator.validate('DROP TABLE users').valid).toBe(false);
    expect(validator.validate('SELECT 1; DELETE FROM users').valid).toBe(false);
  });

  it('rejects unparseable SQL instead of letting it through', () => {
    // Starts with SELECT and has no forbidden keyword, but is not valid SQL —
    // the parser fails and we must fail closed.
    const res = validator.validate('SELECT FROM WHERE )(');
    expect(res.valid).toBe(false);
    expect(res.riskLevel).toBe('HIGH');
  });
});

describe('SqlValidatorService structured output', () => {
  const validator = new SqlValidatorService();

  it('extracts explanation and confidence', () => {
    const res = validator.extractMeta(
      '```sql\nSELECT 1\n```\nEXPLANATION: Returns a constant.\nCONFIDENCE: 92',
    );
    expect(res.explanation).toBe('Returns a constant.');
    expect(res.confidence).toBe(92);
  });

  it('clamps confidence to 0-100 and tolerates missing meta', () => {
    expect(validator.extractMeta('CONFIDENCE: 250').confidence).toBe(100);
    expect(validator.extractMeta('SELECT 1').confidence).toBeNull();
    expect(validator.extractMeta('SELECT 1').explanation).toBeNull();
  });

  it('derives tables and columns accessed from the SQL', () => {
    const { tables, columns } = validator.extractAccessed(
      'SELECT u.id, o.total_amount FROM users u JOIN orders o ON u.id = o.user_id',
    );
    expect(tables.sort()).toEqual(['orders', 'users']);
    expect(columns).toEqual(expect.arrayContaining(['id', 'total_amount', 'user_id']));
  });

  it('does not list "*" as a column for SELECT *', () => {
    const { columns } = validator.extractAccessed('SELECT * FROM users');
    expect(columns).not.toContain('*');
  });
});

describe('SqlValidatorService.parseClarification', () => {
  const validator = new SqlValidatorService();

  const clarifyJson = (options: Array<{ label: string; sql: string }>) =>
    '```json\n' +
    JSON.stringify({ clarify: 'Which did you mean?', options }) +
    '\n```';

  it('parses a valid clarification with 2+ SELECT options', () => {
    const res = validator.parseClarification(
      clarifyJson([
        { label: 'By order count', sql: 'SELECT customer_id FROM orders' },
        { label: 'By total spend', sql: 'SELECT customer_id, SUM(total) FROM orders GROUP BY customer_id' },
      ]),
    );
    expect(res.is).toBe(true);
    expect(res.options).toHaveLength(2);
    expect(res.clarify).toBe('Which did you mean?');
  });

  it('drops options whose SQL is not a safe SELECT', () => {
    const res = validator.parseClarification(
      clarifyJson([
        { label: 'Legit', sql: 'SELECT * FROM users' },
        { label: 'Evil', sql: 'DROP TABLE users' },
      ]),
    );
    // Only one valid option remains → not a usable clarification.
    expect(res.is).toBe(false);
  });

  it('returns is:false for a plain SQL response', () => {
    const res = validator.parseClarification('```sql\nSELECT 1\n```');
    expect(res.is).toBe(false);
  });

  it('returns is:false for malformed JSON', () => {
    const res = validator.parseClarification('```json\n{ not valid json ]\n```');
    expect(res.is).toBe(false);
  });

  it('parses a bare JSON object without a fenced block', () => {
    const res = validator.parseClarification(
      JSON.stringify({
        clarify: 'Pick one',
        options: [
          { label: 'A', sql: 'SELECT 1' },
          { label: 'B', sql: 'SELECT 2' },
        ],
      }),
    );
    expect(res.is).toBe(true);
    expect(res.options).toHaveLength(2);
  });

  it('falls back to a default clarify prompt when none is provided', () => {
    const res = validator.parseClarification(
      JSON.stringify({
        options: [
          { label: 'A', sql: 'SELECT 1' },
          { label: 'B', sql: 'SELECT 2' },
        ],
      }),
    );
    expect(res.is).toBe(true);
    expect(res.clarify).toBe('Which did you mean?');
  });
});
