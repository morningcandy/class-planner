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

test('picks the Thursday to assign only from Wednesday 07:00 through Thursday', () => {
  const context = appsScriptContext();
  const run = (now) => vm.runInContext(`recyclingTarget_(${JSON.stringify(now)})`, context);
  assert.equal(run('2026-09-29 12:00'), '');
  assert.equal(run('2026-09-30 06:59'), '');
  assert.equal(run('2026-09-30 07:00'), '2026-10-01');
  assert.equal(run('2026-10-01 15:00'), '2026-10-01');
  assert.equal(run('2026-10-02 08:00'), '');
  assert.equal(vm.runInContext("dateAdd_('2026-09-30', 2)", context), '2026-10-02');
  assert.equal(vm.runInContext("dateAdd_('2026-10-01', -1)", context), '2026-09-30');
});

test('assigns recycling in late order, two per week, pushing repeated numbers to later weeks', () => {
  const context = appsScriptContext();
  const late = (id, date, number, extra) => Object.assign(
    { late_id: id, date, number: String(number), student_id: 'S' + String(number).padStart(3, '0'), status: '유효', duty_id: '', created_at: date + 'T08:30:00+09:00' },
    extra || {}
  );
  context.__lates = [
    late('L3', '2026-09-25', 12),
    late('L1', '2026-09-24', 5),
    late('L2', '2026-09-24', 5, { created_at: '2026-09-24T08:31:00+09:00' }),
    late('L4', '2026-09-28', 20),
    late('L5', '2026-09-28', 7, { status: '취소' }),
    late('L6', '2026-09-23', 9, { duty_id: 'R_old' }),
  ];
  context.__duties = [];
  const picks = JSON.parse(vm.runInContext("JSON.stringify(planRecycling_('2026-10-01', __duties, __lates, 2))", context));
  assert.deepEqual(picks.map((pick) => pick.number), [5, 12]);
  assert.deepEqual(picks.map((pick) => pick.late_ids), [['L1'], ['L3']]);
  assert.equal(picks[0].student_id, 'S005');

  // 다음 주: L2(5번 두 번째)와 L4(20번)가 남아 있다.
  context.__lates = context.__lates.map((row) => (row.late_id === 'L1' || row.late_id === 'L3') ? Object.assign({}, row, { duty_id: 'R' }) : row);
  const next = JSON.parse(vm.runInContext("JSON.stringify(planRecycling_('2026-10-08', __duties, __lates, 2))", context));
  assert.deepEqual(next.map((pick) => pick.number), [5, 20]);
});

test('puts last week unfinished recycling duty first', () => {
  const context = appsScriptContext();
  context.__duties = [
    { duty_id: 'R1', duty_date: '2026-10-01', number: '12', student_id: 'S012', late_ids: 'L3', status: '배정' },
    { duty_id: 'R0', duty_date: '2026-10-01', number: '5', student_id: 'S005', late_ids: 'L1', status: '완료' },
    { duty_id: 'R9', duty_date: '2026-10-08', number: '3', student_id: 'S003', late_ids: 'L9', status: '배정' },
  ];
  context.__lates = [
    { late_id: 'L2', date: '2026-09-24', number: '5', student_id: 'S005', status: '유효', duty_id: '', created_at: 'a' },
    { late_id: 'L4', date: '2026-09-28', number: '12', student_id: 'S012', status: '유효', duty_id: '', created_at: 'b' },
  ];
  const picks = JSON.parse(vm.runInContext("JSON.stringify(planRecycling_('2026-10-08', __duties, __lates, 2))", context));
  assert.deepEqual(picks.map((pick) => [pick.number, pick.carried_from]), [[12, 'R1'], [5, '']]);
});
