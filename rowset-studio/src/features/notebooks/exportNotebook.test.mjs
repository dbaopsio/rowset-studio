import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notebookFileName, notebookToMarkdown, notebookToSQL } from './exportNotebook.ts';

const doc = {
  title: 'Weekly checks',
  cells: [
    { id: '1', kind: 'markdown', content: '## Orders\nLate orders only.' },
    { id: '2', kind: 'sql', content: 'SELECT id FROM orders WHERE late', connectionId: 'c1', database: 'sales' },
    { id: '3', kind: 'sql', content: 'SELECT 1;' },
    { id: '4', kind: 'sql', content: '   ' },
  ],
};

test('markdown export fences SQL and names its connection', () => {
  const text = notebookToMarkdown(doc, { c1: 'Production' });
  assert.ok(text.startsWith('# Weekly checks\n\n## Orders\nLate orders only.'));
  assert.ok(text.includes('```sql\n-- connection: Production, database: sales\nSELECT id FROM orders WHERE late\n```'));
  assert.ok(text.includes('```sql\nSELECT 1;\n```'));
});

test('sql export comments notes and terminates statements', () => {
  const text = notebookToSQL(doc, { c1: 'Production' });
  assert.ok(text.includes('-- ## Orders\n-- Late orders only.'));
  assert.ok(text.includes('-- connection: Production, database: sales\nSELECT id FROM orders WHERE late;'));
  assert.ok(text.includes('SELECT 1;'));
  assert.ok(!text.includes('SELECT 1;;'));
});

test('file names are safe on every platform', () => {
  assert.equal(notebookFileName('a/b:c*?', 'md'), 'a_b_c__.md');
  assert.equal(notebookFileName('   ', 'sql'), 'notebook.sql');
});
