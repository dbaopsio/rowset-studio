import test from 'node:test';
import assert from 'node:assert/strict';
import { filteredIndexes } from './resultFilter.ts';

test('filters return original indexes for edits, with AND semantics', () => {
  const rows = [[1,'Alpha'],[2,'Beta'],[3,'ALPHABET']];
  assert.deepEqual(filteredIndexes(rows, [{column:1,operator:'contains',value:'alpha'},{column:0,operator:'gt',value:'1'}], ['INTEGER','TEXT']), [2]);
  assert.deepEqual(rows[2], [3,'ALPHABET']);
});
test('numeric filters retain bigint and decimal precision; text IDs stay text', () => {
  assert.deepEqual(filteredIndexes([[2],[10]],[{column:0,operator:'gt',value:'9'}]),[1]);
  const rows = [['9007199254740992'],['9007199254740993'],['9007199254740994']];
  assert.deepEqual(filteredIndexes(rows,[{column:0,operator:'eq',value:'9007199254740993'}],['BIGINT']),[1]);
  assert.deepEqual(filteredIndexes([['1.0000000000000000001'],['1.0000000000000000002']],[{column:0,operator:'gt',value:'1.0000000000000000001'}],['DECIMAL']),[1]);
  assert.deepEqual(filteredIndexes([['001'],['1']],[{column:0,operator:'eq',value:'1'}],['TEXT']),[1]);
});
test('NULL differs from empty text and JSON is searchable', () => {
  const rows = [[null],[''],[{nested:'value'}]];
  assert.deepEqual(filteredIndexes(rows,[{column:0,operator:'null',value:''}]),[0]);
  assert.deepEqual(filteredIndexes(rows,[{column:0,operator:'eq',value:''}]),[1]);
  assert.deepEqual(filteredIndexes(rows,[{column:-1,operator:'contains',value:'VALUE'}]),[2]);
  assert.deepEqual(filteredIndexes(rows,[]),[0,1,2]);
});
