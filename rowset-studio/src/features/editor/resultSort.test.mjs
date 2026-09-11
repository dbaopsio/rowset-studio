import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareCells } from './resultSort.ts';

test('large integers and exact decimals sort without floating point conversion', () => {
  assert(compareCells('9007199254740993', '9007199254740992', 'BIGINT') > 0);
  assert(compareCells('0.12345678901234567891', '0.12345678901234567890', 'NUMERIC') > 0);
  assert(compareCells('-9007199254740993', '-9007199254740992', 'BIGINT') < 0);
  assert.equal(compareCells('01.00', '1e0', 'DECIMAL'), 0);
  assert(compareCells('1e999999999', '9e999999998', 'NUMERIC') > 0);
  assert(compareCells('-0.0001', '0', 'NUMERIC') < 0);
  assert.equal(compareCells('-0', '0.00', 'NUMERIC'), 0);
});
test('NULL stays last and text IDs stay textual', () => {
  assert(compareCells(null, 1, 'INT', 'desc') > 0);
  assert(compareCells(1, undefined, 'INT', 'asc') < 0);
  assert(compareCells('10', '2', 'VARCHAR') < 0);
  assert(compareCells('10', '2', 'INT', 'desc') < 0);
  assert(compareCells('', '0', 'INT') < 0);
});
