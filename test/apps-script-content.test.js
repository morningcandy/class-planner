'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function appsScriptContext() {
  const context = vm.createContext({
    console,
    Utilities: { formatDate: () => '2026-08-16' },
    Session: { getScriptTimeZone: () => 'Asia/Seoul' },
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script.gs'), 'utf8');
  vm.runInContext(source, context);
  return context;
}

test('preserves a timetable markdown table through prepared command analysis', () => {
  const context = appsScriptContext();
  const raw = '/공지사항 [학급]\n학급 시간표\n| 교시 | 월 | 화 |\n| --- | --- | --- |\n| 1 | 국어 | 수학 |';
  const command = vm.runInContext(`parseCommand_(${JSON.stringify(raw)})`, context);
  context.__command = command;
  const analysis = vm.runInContext('fallbackAnalysis_(__command)', context);
  assert.equal(analysis.notices.length, 1);
  assert.match(analysis.notices[0].content, /\| 교시 \| 월 \| 화 \|/);
  assert.match(analysis.notices[0].content, /\| 1 \| 국어 \| 수학 \|/);
});

test('does not split a markdown separator row into command blocks', () => {
  const context = appsScriptContext();
  const raw = '/공지사항 [학급]\n시간표\n| 교시 | 월 |\n| --- | --- |\n| 1 | 국어 |';
  context.__raw = raw;
  const blocks = vm.runInContext('splitCommandBlocks_(__raw)', context);
  assert.equal(blocks.length, 1);
});

test('builds and validates a six-digit number plus phone suffix student code', () => {
  const context = appsScriptContext();
  assert.equal(vm.runInContext("makeStudentCode_('1', '010-5555-1234')", context), '011234');
  assert.equal(vm.runInContext("makeStudentCode_('1', '991234')", context), '011234');
  assert.equal(vm.runInContext("makeStudentCode_('12', '010-5555-9876')", context), '129876');
  assert.equal(vm.runInContext("normalizeStudentCode_('01-1234')", context), '011234');
  assert.equal(vm.runInContext("normalizeStudentCode_('11234')", context), '');
  context.__student = { number: 1, personal_code: '011234' };
  assert.equal(vm.runInContext('validStudentCode_(__student)', context), true);
  context.__student.personal_code = '021234';
  assert.equal(vm.runInContext('validStudentCode_(__student)', context), false);
});

test('keeps the personal-code sheet column in text format for leading zeroes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script.gs'), 'utf8');
  assert.match(source, /getRange\('D2:D'\)\.setNumberFormat\('@'\)/);
});
