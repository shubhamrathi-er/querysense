import { selectRelevantTables, type RelevanceTable } from './schema-relevance';

const col = (
  columnName: string,
  fk?: { referencesTable: string },
): RelevanceTable['columns'][number] => ({
  columnName,
  isForeignKey: !!fk,
  referencesTable: fk?.referencesTable ?? null,
});

const table = (
  tableName: string,
  columns: RelevanceTable['columns'],
  extra?: Partial<RelevanceTable>,
): RelevanceTable => ({ tableName, columns, ...extra });

// A wide-enough schema (> alwaysAllUnder) so filtering actually engages.
function wideSchema(): RelevanceTable[] {
  return [
    table('orders', [col('id'), col('customer_id', { referencesTable: 'customers' }), col('total')]),
    table('customers', [col('id'), col('name'), col('email')]),
    table('products', [col('id'), col('title'), col('price')]),
    table('order_items', [
      col('id'),
      col('order_id', { referencesTable: 'orders' }),
      col('product_id', { referencesTable: 'products' }),
    ]),
    table('inventory', [col('id'), col('product_id', { referencesTable: 'products' }), col('qty')]),
    table('suppliers', [col('id'), col('name')]),
    table('shipments', [col('id'), col('order_id', { referencesTable: 'orders' })]),
    table('reviews', [col('id'), col('product_id', { referencesTable: 'products' }), col('rating')]),
    table('payments', [col('id'), col('order_id', { referencesTable: 'orders' }), col('amount')]),
  ];
}

describe('selectRelevantTables', () => {
  it('passes small schemas through unchanged', () => {
    const small = wideSchema().slice(0, 5);
    const res = selectRelevantTables(small, 'how many orders');
    expect(res.filtered).toBe(false);
    expect(res.tables).toHaveLength(5);
  });

  it('returns the full schema when the question has no usable keywords', () => {
    const res = selectRelevantTables(wideSchema(), 'show me everything please');
    expect(res.filtered).toBe(false);
  });

  it('selects the table matched by name', () => {
    const res = selectRelevantTables(wideSchema(), 'list all customers');
    expect(res.tables.map((t) => t.tableName)).toContain('customers');
    expect(res.filtered).toBe(true);
  });

  it('expands along foreign keys so joins stay valid', () => {
    // "orders" references "customers"; that neighbour must come along.
    const res = selectRelevantTables(wideSchema(), 'total revenue from orders');
    const names = res.tables.map((t) => t.tableName);
    expect(names).toContain('orders');
    expect(names).toContain('customers');
  });

  it('drops clearly-irrelevant tables', () => {
    const res = selectRelevantTables(wideSchema(), 'list all customers');
    expect(res.tables.map((t) => t.tableName)).not.toContain('suppliers');
  });

  it('matches on column names too', () => {
    const res = selectRelevantTables(wideSchema(), 'average rating');
    expect(res.tables.map((t) => t.tableName)).toContain('reviews');
  });
});
