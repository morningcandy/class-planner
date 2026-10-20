/* 상담 일정표 (학사일정 달력 위)
   학생 상담 앱(student-counsel)과 학부모 상담 앱(sandam-app)의 예약을 그대로 읽어와 날짜별로 보여준다.
   취소된 예약은 빼고, 상담 내용·연락처는 받지도 표시하지도 않는다.
   두 앱의 열쇠(학생 앱 관리자 비밀번호, 학부모 앱 Supabase anon 키)는 이 브라우저 localStorage에만 둔다.
   달력 자체에는 반영하지 않는다(달력은 학사일정 전용). 마지막 상담일이 지나면 패널을 숨긴다. */
(function () {
  'use strict';

  const PERIODS = [
    { kind: 'student', label: '학생 상담', start: '2026-10-20', end: '2026-10-30' },
    { kind: 'parent', label: '학부모 상담', start: '2026-11-02', end: '2026-11-06' }
  ];
  const STUDENT_FEED = 'https://student-counsel.vercel.app/api/admin/feed';
  const PARENT_API = 'https://tkulspxyjcnhafdhfajo.supabase.co/rest/v1/reservations'
    + '?select=student_number,student_name,counseling_method,status,slots(date,title,start_time,end_time)'
    + '&status=neq.' + encodeURIComponent('예약 취소');
  const KEY_STUDENT = 'classPlanner.counsel.studentPw';
  const KEY_PARENT = 'classPlanner.counsel.parentKey';

  const panel = document.getElementById('counselPanel');
  const body = document.getElementById('counselBody');
  const note = document.getElementById('counselNote');
  const form = document.getElementById('counselSetup');
  if (!panel || !body) return;

  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const lastDay = PERIODS[PERIODS.length - 1].end;
  if (lastDay < today) return;

  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const wd = (d) => WD[new Date(`${d}T00:00:00`).getDay()];
  const inPeriod = (kind, date) => PERIODS.some((p) => p.kind === kind && date >= p.start && date <= p.end);
  const hm = (t) => String(t || '').slice(0, 5);

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
  function readKey(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }
  function writeKey(key, value) {
    try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch (e) { /* 저장 불가 브라우저 */ }
  }
  // 학번 20317 → 17번
  const numberOf = (id) => {
    const s = String(id || '');
    return s.length >= 2 ? `${Number(s.slice(-2))}번` : '';
  };

  async function loadStudent() {
    const pw = readKey(KEY_STUDENT);
    if (!pw) return { items: [], error: '학생 상담 앱 연결 필요' };
    const res = await fetch(STUDENT_FEED, { headers: { 'x-admin-password': pw }, cache: 'no-store' });
    if (res.status === 401) return { items: [], error: '학생 상담 앱 비밀번호가 맞지 않습니다' };
    if (!res.ok) return { items: [], error: `학생 상담 앱 응답 오류(${res.status})` };
    const data = await res.json();
    const items = (data.items || [])
      .filter((b) => inPeriod('student', b.date))
      .map((b) => ({
        kind: 'student',
        date: b.date,
        start: b.slot.split('-')[0],
        end: b.slot.split('-')[1] || '',
        tag: b.tag,
        number: numberOf(b.studentId),
        name: b.name,
        method: '',
        done: b.status === 'completed'
      }));
    return { items };
  }

  async function loadParent() {
    const key = readKey(KEY_PARENT);
    if (!key) return { items: [], error: '학부모 상담 앱 연결 필요' };
    const res = await fetch(PARENT_API, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' });
    if (res.status === 401) return { items: [], error: '학부모 상담 앱 키가 맞지 않습니다' };
    if (!res.ok) return { items: [], error: `학부모 상담 앱 응답 오류(${res.status})` };
    const rows = await res.json();
    const items = rows
      .filter((r) => r.slots && inPeriod('parent', r.slots.date))
      .map((r) => ({
        kind: 'parent',
        date: r.slots.date,
        start: hm(r.slots.start_time),
        end: hm(r.slots.end_time),
        tag: r.slots.title || '',
        number: numberOf(r.student_number),
        name: r.student_name,
        method: r.counseling_method || '',
        done: r.status === '상담 완료'
      }));
    return { items };
  }

  function rowHtml(it) {
    const badge = it.kind === 'student' ? '<span class="cs-badge student">학생</span>' : '<span class="cs-badge parent">학부모</span>';
    const method = it.method ? `<span class="cs-method">${escapeHtml(it.method)}</span>` : '';
    return `<li class="cs-row${it.done ? ' done' : ''}">`
      + `<span class="cs-time">${escapeHtml(it.start)}<small>${escapeHtml(it.tag)}</small></span>`
      + `${badge}<span class="cs-who">${escapeHtml(it.number)} ${escapeHtml(it.name)}</span>${method}`
      + `${it.done ? '<span class="cs-done">완료</span>' : ''}</li>`;
  }

  function render(items, errors) {
    items.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const byDate = new Map();
    items.forEach((it) => {
      if (!byDate.has(it.date)) byDate.set(it.date, []);
      byDate.get(it.date).push(it);
    });
    const upcoming = [...byDate.keys()].filter((d) => d >= today);
    const past = [...byDate.keys()].filter((d) => d < today);

    const dayBlock = (d) => `<div class="cs-day${d === today ? ' today' : ''}">`
      + `<p class="cs-date">${md(d)}(${wd(d)})${d === today ? ' <b>오늘</b>' : ''}<span>${byDate.get(d).length}건</span></p>`
      + `<ul>${byDate.get(d).map(rowHtml).join('')}</ul></div>`;

    let html = errors.map((e) => `<p class="cs-error">${escapeHtml(e)} — 오른쪽 위 ⚙에서 연결하세요.</p>`).join('');
    html += upcoming.length ? upcoming.map(dayBlock).join('') : '<p class="muted cs-empty">남은 상담 예약이 없습니다.</p>';
    if (past.length) {
      const pastCount = past.reduce((n, d) => n + byDate.get(d).length, 0);
      html += `<details class="cs-past"><summary>지난 상담 ${pastCount}건</summary>${past.reverse().map(dayBlock).join('')}</details>`;
    }
    body.innerHTML = html;
  }

  async function refresh() {
    body.innerHTML = '<p class="muted cs-empty">상담 예약을 불러오는 중입니다.</p>';
    const results = await Promise.all([loadStudent(), loadParent()].map((p) => p.catch(() => ({ items: [], error: '상담 앱에 연결하지 못했습니다' }))));
    const items = results.flatMap((r) => r.items);
    const errors = results.map((r) => r.error).filter(Boolean);
    render(items, errors);
  }

  if (note) note.textContent = PERIODS.map((p) => `${p.label} ${md(p.start)}~${md(p.end)}`).join(' · ');

  if (form) {
    const studentInput = document.getElementById('counselStudentPw');
    const parentInput = document.getElementById('counselParentKey');
    document.getElementById('counselSetupBtn').addEventListener('click', () => {
      form.classList.toggle('hidden');
      studentInput.value = '';
      parentInput.value = '';
      studentInput.placeholder = readKey(KEY_STUDENT) ? '저장됨 (바꿀 때만 입력)' : '학생 상담 앱 관리자 비밀번호';
      parentInput.placeholder = readKey(KEY_PARENT) ? '저장됨 (바꿀 때만 입력)' : '학부모 상담 앱 Supabase anon 키';
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (studentInput.value.trim()) writeKey(KEY_STUDENT, studentInput.value.trim());
      if (parentInput.value.trim()) writeKey(KEY_PARENT, parentInput.value.trim());
      studentInput.value = '';
      parentInput.value = '';
      form.classList.add('hidden');
      refresh();
    });
    document.getElementById('counselForgetBtn').addEventListener('click', () => {
      writeKey(KEY_STUDENT, '');
      writeKey(KEY_PARENT, '');
      form.classList.add('hidden');
      refresh();
    });
  }
  document.getElementById('counselRefreshBtn')?.addEventListener('click', refresh);

  panel.classList.remove('hidden');
  refresh();
})();
