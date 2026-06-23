import { analyzeDependencies } from './dependency';

describe('analyzeDependencies', () => {
  it('orders parents before children', () => {
    const r = analyzeDependencies(
      ['customers', 'orders', 'order_items'],
      [
        { table: 'orders', refTable: 'customers' },
        { table: 'order_items', refTable: 'orders' },
      ],
    );
    expect(r.order.indexOf('customers')).toBeLessThan(r.order.indexOf('orders'));
    expect(r.order.indexOf('orders')).toBeLessThan(r.order.indexOf('order_items'));
    expect(r.parents['orders']).toContain('customers');
    expect(r.children['customers']).toContain('orders');
  });

  it('detects self-referencing tables', () => {
    const r = analyzeDependencies(
      ['employees'],
      [{ table: 'employees', refTable: 'employees' }],
    );
    expect(r.selfReferencing).toEqual(['employees']);
    expect(r.order).toEqual(['employees']);
  });

  it('detects circular dependencies', () => {
    const r = analyzeDependencies(
      ['a', 'b'],
      [
        { table: 'a', refTable: 'b' },
        { table: 'b', refTable: 'a' },
      ],
    );
    expect(r.circular.length).toBe(1);
    expect(r.circular[0].sort()).toEqual(['a', 'b']);
    expect(r.order.sort()).toEqual(['a', 'b']); // still covered
  });

  it('ignores FK edges to tables outside the selection', () => {
    const r = analyzeDependencies(
      ['orders'],
      [{ table: 'orders', refTable: 'customers' }],
    );
    expect(r.parents['orders']).toEqual([]);
    expect(r.order).toEqual(['orders']);
  });

  it('handles tables with no FKs', () => {
    const r = analyzeDependencies(['a', 'b', 'c'], []);
    expect(r.order.sort()).toEqual(['a', 'b', 'c']);
    expect(r.circular).toEqual([]);
  });
});
