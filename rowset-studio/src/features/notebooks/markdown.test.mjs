import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headingText, parseInline, parseMarkdown } from './markdown.ts';

test('markdown subset produces structured blocks', () => {
  const blocks = parseMarkdown('# Orders\nDaily **checks** for `orders`.\n\n- first\n- second\n\n```\nSELECT 1\n```');
  assert.deepEqual(blocks.map((block) => block.type), ['heading', 'paragraph', 'list', 'code']);
  assert.equal(blocks[0].level, 1);
  assert.deepEqual(blocks[1].inline.map((part) => part.type), ['text', 'bold', 'text', 'code', 'text']);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[3].text, 'SELECT 1');
});

test('markup is data, links are limited to http(s)', () => {
  const inline = parseInline('<img src=x onerror=alert(1)> [docs](https://example.com) [bad](javascript:alert(1))');
  assert.equal(inline[0].type, 'text');
  assert.ok(inline[0].text.includes('<img'));
  const links = inline.filter((part) => part.type === 'link');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://example.com');
});

test('first heading titles an opened cell', () => {
  assert.equal(headingText('text\n### Revenue by month'), 'Revenue by month');
  assert.equal(headingText('no heading'), undefined);
});
