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

test('normalizes scheduled publish times to Korean local minutes', () => {
  const context = appsScriptContext();
  const run = (value) => vm.runInContext(`normalizeDateTime_(${JSON.stringify(value)})`, context);
  assert.equal(run(''), '');
  assert.equal(run('2026-09-18T08:00'), '2026-09-18 08:00');
  assert.equal(run('2026-09-18 8:05'), '2026-09-18 08:05');
  assert.equal(run('2026-09-18'), '2026-09-18 00:00');
  assert.equal(run('2026. 9. 18 오후 1:30:00'), '2026-09-18 13:30');
  assert.equal(run('2026. 9. 18 오전 12:10:00'), '2026-09-18 00:10');
  assert.equal(run('내일 아침'), '9999-12-31 23:59');
});

test('hides a published notice until its scheduled start time', () => {
  const context = appsScriptContext();
  const live = (notice, now) => vm.runInContext(
    `isNoticeLive_(${JSON.stringify(notice)}, ${JSON.stringify(now)})`, context);
  const scheduled = { status: '게시됨', starts_at: '2026-09-18 08:00' };
  assert.equal(live(scheduled, '2026-09-18 07:59'), false);
  assert.equal(live(scheduled, '2026-09-18 08:00'), true);
  assert.equal(live({ status: '게시됨', starts_at: '' }, '2026-09-17 12:00'), true);
  assert.equal(live({ status: '검토대기', starts_at: '2026-09-01 08:00' }, '2026-09-17 12:00'), false);
  assert.equal(live({ status: '게시됨', starts_at: '알 수 없음' }, '2026-09-17 12:00'), false);
});

test('keeps a call on the classroom screen only on the day it was made', () => {
  const context = appsScriptContext();
  const active = (call, today) => vm.runInContext(
    `isCallActive_(${JSON.stringify(call)}, ${JSON.stringify(today)})`, context);
  const call = { status: '호출중', created_at: '2026-09-23T11:20:00+09:00' };
  assert.equal(active(call, '2026-09-23'), true);
  assert.equal(active(call, '2026-09-24'), false);
  assert.equal(active({ status: '전달완료', created_at: '2026-09-23T11:20:00+09:00' }, '2026-09-23'), false);
  assert.equal(active({ status: '취소', created_at: '2026-09-23T11:20:00+09:00' }, '2026-09-23'), false);
  assert.equal(active({ status: '호출중', created_at: '' }, '2026-09-23'), false);
});

test('exposes only display fields of a call, never the student code', () => {
  const context = appsScriptContext();
  const shaped = vm.runInContext(`publicCall_(${JSON.stringify({
    call_id: 'C1', student_id: 'S002', number: '2', caller: '담임T',
    reason: '결석신고서 제출', status: '호출중', created_at: '2026-09-23T11:20:00+09:00',
    acked_at: '', acked_by: '', personal_code: '021234',
  })})`, context);
  assert.deepEqual(Object.keys(shaped).sort(),
    ['ackedAt', 'caller', 'createdAt', 'id', 'number', 'reason', 'status'].sort());
  assert.equal(shaped.number, 2);
  assert.equal(JSON.stringify(shaped).includes('021234'), false);
});
