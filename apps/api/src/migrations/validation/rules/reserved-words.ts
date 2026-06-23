// A practical subset of MySQL reserved words for identifier checks.
const RESERVED = new Set(
  [
    'ADD', 'ALL', 'ALTER', 'AND', 'AS', 'ASC', 'BETWEEN', 'BY', 'CALL', 'CASE',
    'CHANGE', 'CHARACTER', 'CHECK', 'COLLATE', 'COLUMN', 'CONDITION', 'CONSTRAINT',
    'CONTINUE', 'CONVERT', 'CREATE', 'CROSS', 'CURRENT_DATE', 'CURRENT_TIME',
    'CURRENT_TIMESTAMP', 'CURRENT_USER', 'CURSOR', 'DATABASE', 'DATABASES',
    'DEFAULT', 'DELETE', 'DESC', 'DESCRIBE', 'DISTINCT', 'DIV', 'DROP', 'DUAL',
    'EACH', 'ELSE', 'ELSEIF', 'EXISTS', 'EXIT', 'EXPLAIN', 'FALSE', 'FETCH',
    'FLOAT', 'FOR', 'FOREIGN', 'FROM', 'FULLTEXT', 'GRANT', 'GROUP', 'GROUPS',
    'HAVING', 'IF', 'IGNORE', 'IN', 'INDEX', 'INNER', 'INSERT', 'INT', 'INTEGER',
    'INTERVAL', 'INTO', 'IS', 'JOIN', 'KEY', 'KEYS', 'KILL', 'LEADING', 'LEAVE',
    'LEFT', 'LIKE', 'LIMIT', 'LINES', 'LOAD', 'LOCK', 'LONG', 'MATCH', 'NOT',
    'NULL', 'ON', 'OPTIMIZE', 'OPTION', 'OR', 'ORDER', 'OUT', 'OUTER', 'PARTITION',
    'PRIMARY', 'PROCEDURE', 'RANGE', 'READ', 'REFERENCES', 'RENAME', 'REPEAT',
    'REPLACE', 'REQUIRE', 'RESTRICT', 'RETURN', 'REVOKE', 'RIGHT', 'RLIKE',
    'SCHEMA', 'SELECT', 'SET', 'SHOW', 'SQL', 'TABLE', 'THEN', 'TO', 'TRIGGER',
    'TRUE', 'UNION', 'UNIQUE', 'UNLOCK', 'UPDATE', 'USAGE', 'USE', 'USING',
    'VALUES', 'VARCHAR', 'WHEN', 'WHERE', 'WHILE', 'WITH', 'WRITE', 'XOR',
    'RANK', 'ROW', 'ROWS', 'SYSTEM', 'WINDOW',
  ].map((w) => w.toUpperCase()),
);

export function isReservedWord(name: string): boolean {
  return RESERVED.has(name.toUpperCase());
}
