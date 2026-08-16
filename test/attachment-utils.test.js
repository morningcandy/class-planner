'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeFiles } = require('../attachment-utils');

function file(name, size, lastModified) {
  return { name, size, lastModified };
}

test('keeps earlier files when a later selection is added', () => {
  const first = [file('시간표.xlsx', 1200, 1), file('안내.pdf', 1500, 2)];
  const result = mergeFiles(first, [file('교실.jpg', 900, 3)]);
  assert.deepEqual(result.files.map((item) => item.name), ['시간표.xlsx', '안내.pdf', '교실.jpg']);
  assert.equal(result.error, '');
});

test('deduplicates a file selected twice and preserves the current list on error', () => {
  const current = [file('시간표.xlsx', 1200, 1)];
  assert.equal(mergeFiles(current, current).files.length, 1);
  const invalid = mergeFiles(current, [file('실행파일.exe', 10, 2)]);
  assert.deepEqual(invalid.files, current);
  assert.match(invalid.error, /지원 형식/);
});
