import { isReservedWord } from './reserved-words';

describe('isReservedWord', () => {
  it('detects reserved words case-insensitively', () => {
    expect(isReservedWord('order')).toBe(true);
    expect(isReservedWord('ORDER')).toBe(true);
    expect(isReservedWord('select')).toBe(true);
    expect(isReservedWord('Group')).toBe(true);
  });
  it('allows normal identifiers', () => {
    expect(isReservedWord('customers')).toBe(false);
    expect(isReservedWord('order_items')).toBe(false);
    expect(isReservedWord('user_id')).toBe(false);
  });
});
