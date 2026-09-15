import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConnectionURL } from './connectionURL.ts';
test('connection URLs preserve encoded credentials and IPv6', () => {
  const value=parseConnectionURL('postgresql://owner:p%40ss%23word@[::1]:5544/app%20db?sslmode=require');
  assert.equal(value.host,'::1');assert.equal(value.password,'p@ss#word');assert.equal(value.database,'app db');assert.equal(value.port,5544);assert.equal(value.tlsMode,'require');
});
test('TLS verification requested by a URL is preserved', () => {
  assert.equal(parseConnectionURL('postgres://db/app?sslmode=verify-full').tlsMode,'verify-full');
  assert.equal(parseConnectionURL('postgres://db/app?sslmode=verify-ca').tlsMode,'verify-ca');
  assert.equal(parseConnectionURL('postgres://db/app').tlsMode,'verify-full');
  assert.equal(parseConnectionURL('mysql://db/app?ssl=false').tlsMode,'disable');
  assert.equal(parseConnectionURL('sqlserver://db/app?encrypt=true').tlsMode,'verify-full');
  assert.equal(parseConnectionURL('sqlserver://db/app?encrypt=true&TrustServerCertificate=true').tlsMode,'require');
  assert.equal(parseConnectionURL('sqlserver://db?database=Sales&user=Ada&password=Pa55').password,'Pa55');
});
test('unsupported security options are never silently downgraded', () => {
  assert.throws(()=>parseConnectionURL('postgres://db/app?sslmode=prefer'),/cannot be represented/);
  assert.throws(()=>parseConnectionURL('postgres://db/app?sslrootcert=ca.pem'),/not supported/);
  assert.throws(()=>parseConnectionURL('mssql://db/app?encrypt=strict'),/cannot be represented/);
  assert.throws(()=>parseConnectionURL('postgres://db/app?trustServerCertificate=true'),/only to SQL Server/);
  assert.throws(()=>parseConnectionURL('postgres://db/app?sslmode=require&ssl=false'),/only one/);
  assert.throws(()=>parseConnectionURL('postgres://db/app?sslmode=require&sslmode=disable'),/Duplicate/);
});
test('unsupported protocols and ambiguous fragments are rejected', () => {
  assert.throws(()=>parseConnectionURL('https://example.com'),/Use a/);
  assert.throws(()=>parseConnectionURL('mysql://user:pass@db/app#word'),/Encode/);
});
test('additional engines preserve file paths and reject unsupported Mongo authentication', () => {
  const sqlite = parseConnectionURL('sqlite:///tmp/app%20data.sqlite');
  assert.equal(sqlite.database, '/tmp/app data.sqlite');
  assert.equal(sqlite.tlsMode, 'disable');
  assert.equal(parseConnectionURL('sqlite:///C:/data/app.sqlite').database, 'C:/data/app.sqlite');
  assert.equal(parseConnectionURL('clickhouse://host/default?ssl=false').port, 9000);
  assert.equal(parseConnectionURL('duckdb:///tmp/a.duckdb').engine, 'duckdb');
  assert.equal(parseConnectionURL('clickhouse://default:p@host/default').port, 9440);
  assert.equal(parseConnectionURL('mongodb://u:p@host/app?authSource=admin&tls=true').tlsMode, 'verify-full');
  assert.throws(() => parseConnectionURL('sqlite:///tmp/a.sqlite?mode=ro'), /without URI options/);
  assert.throws(() => parseConnectionURL('mongodb://host/app?authSource=app'), /authSource=admin/);
  assert.throws(() => parseConnectionURL('mongodb+srv://host/app'), /SRV/);
});
