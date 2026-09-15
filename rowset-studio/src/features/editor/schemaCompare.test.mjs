import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSchemas, migrationDraft } from './schemaCompare.ts';

const col = (name, extra = {}) => ({ name, dataType: 'integer', nullable: true, ...extra });
const schema = tables => ({ name: 'public', tables });
test('matches quoted names exactly and detects type, nullability, PK, FK and index differences', () => {
  const a = schema([{ name: 'Users', columns: [col('id', { pk: true }), col('new')], indexes: [{ name: 'ix', columns: ['id'], unique: true }] }]);
  const b = schema([{ name: 'Users', columns: [col('id'), col('old')], indexes: [{ name: 'ix', columns: ['id'] }] }, { name: 'users', columns: [] }]);
  const differences = compareSchemas(a, b);
  assert.equal(differences.length, 5);
  assert.equal(differences.find(d => d.object === 'new').status, 'add');
  assert.equal(differences.find(d => d.object === 'users').status, 'remove');
  assert.deepEqual(compareSchemas(a, a), []);
});
test('draft only executes safe supported additions and leaves destructive or incomplete changes manual', () => {
  const changes = compareSchemas(schema([{ name: 't', columns: [col('a"b'), col('required', { nullable: false }), col('sequence', { default: 'nextval(\'seq\')' })] }]), schema([{ name: 't', columns: [col('old')] }]));
  const sql = migrationDraft('postgres', 'public', 'public', changes);
  assert.match(sql, /ALTER TABLE "public"\."t" ADD "a""b" integer NULL;/);
  assert.equal(sql.split('\n').filter(l => l.startsWith('ALTER')).length, 1);
  assert.ok(!sql.includes('DROP COLUMN'));
  assert.ok(!migrationDraft('postgres', 'public', 'other', changes).includes('ALTER TABLE'));
});
