import test from 'node:test';
import assert from 'node:assert/strict';
import { mongoQuery, mongoRequest, formatMongoQuery, mongoShellToRequest, isMongoShellQuery, mongoShellToParts, mongoPartsToShell } from './mongoQuery.ts';
test('MongoDB request and formatting preserve raw integers and decimals', () => {
  const source = '{"collection":"items","filter":{"count":9007199254740993,"n":1.12345678901234567890,"text":"a, {b}: c"},"sort":{},"limit":100}';
  assert(mongoRequest(source,'test').includes('9007199254740993'));
  assert(mongoRequest(source,'test').includes('1.12345678901234567890'));
  const formatted = formatMongoQuery(source);
  assert(formatted.includes('9007199254740993'));
  assert(formatted.includes('1.12345678901234567890'));
  assert.deepEqual(JSON.parse(formatted),JSON.parse(source));
  assert.equal(JSON.parse(mongoRequest(mongoQuery('items'),'test')).database,'test');
});
test('MongoDB invalid queries fail locally instead of silently dropping options', () => {
  for (const source of ['[]','{}','{"collection":"items","pipeline":[]}','{"collection":"items","filter":[]}','{"collection":"items","limit":-1}','{"collection":"items","database":"other"}']) assert.throws(()=>mongoRequest(source,'test'));
});
test('MongoDB shell syntax db.collection.find(...) translates to the request JSON', () => {
  assert.equal(isMongoShellQuery('db.customers.find({})'), true);
  assert.equal(isMongoShellQuery('{"collection":"customers"}'), false);
  assert.deepEqual(JSON.parse(mongoShellToRequest('db.customers.find({})')), { collection: 'customers', filter: {}, sort: {}, limit: 100 });
  assert.deepEqual(JSON.parse(mongoShellToRequest('db.customers.find({"age":{"$gt":21}}).sort({"age":-1}).limit(10)')), { collection: 'customers', filter: { age: { $gt: 21 } }, sort: { age: -1 }, limit: 10 });
  const request = JSON.parse(mongoRequest('db.customers.find({"name":"a, {b}"})', 'test'));
  assert.equal(request.collection, 'customers');
  assert.equal(request.database, 'test');
  assert.deepEqual(JSON.parse(mongoShellToRequest('db.customers.find({}, {"name":1})')), { collection: 'customers', filter: {}, sort: {}, limit: 100, project: { name: 1 } });
  assert.deepEqual(JSON.parse(mongoShellToRequest('db.customers.find({}).skip(5)')), { collection: 'customers', filter: {}, sort: {}, limit: 100, skip: 5 });
  assert.throws(() => mongoShellToRequest('not a query'));
});
test('the query bar round-trips through shell syntax, project, skip and max time included', () => {
  const parts = mongoShellToParts('db.customers.find({"age":{"$gt":21}}, {"name":1}).sort({"age":-1}).skip(5).limit(10).maxTimeMS(2000)');
  assert.deepEqual(parts, { collection: 'customers', filter: '{"age":{"$gt":21}}', project: '{"name":1}', sort: '{"age":-1}', skip: '5', limit: '10', maxTimeMs: '2000' });
  assert.equal(mongoPartsToShell(parts), 'db.customers.find({"age":{"$gt":21}}, {"name":1}).sort({"age":-1}).skip(5).limit(10).maxTimeMS(2000)');
  assert.equal(mongoPartsToShell({ collection: 'orders', filter: '{}', project: '{}', sort: '{}', skip: '0', limit: '100', maxTimeMs: '0' }), 'db.orders.find({})');
  const request = JSON.parse(mongoRequest(mongoPartsToShell(parts), 'test'));
  assert.equal(request.skip, 5);
  assert.equal(request.maxTimeMs, 2000);
  assert.deepEqual(request.project, { name: 1 });
});
