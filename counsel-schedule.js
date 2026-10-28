/* 상담 일정표 (학사일정 달력 위)
   학생 상담 앱(student-counsel)과 학부모 상담 앱(sandam-app)의 예약을 읽어와 날짜별로 보여준다.
   두 앱이 취소 건을 빼고 날짜·시간·학생 번호·상태만 내려준다(이름·상담 내용·연락처는 받지 않음).
   달력 자체에는 반영하지 않는다(달력은 학사일정 전용). 마지막 상담일이 지나면 패널을 숨긴다. */
(function () {
  'use strict';

  const PERIODS = [
    { kind: 'student', label: '학생 상담', start: '2026-10-20', end: '2026-11-06' },
    { kind: 'parent', label: '학부모 상담', start: '2026-11-02', end: '2026-11-06' }
  ];
  const STUDENT_FEED = 'https://student-counsel.vercel.app/api/availability?view=planner';
  const PARENT_FEED = 'https://sandam-app.vercel.app/api/counsel-feed';

  const panel = document.getElementById('counselPanel');
  const body = document.getElementById('counselBody');
  const note = document.getElementById('counselNote');
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

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
  async function loadFeed(url, label) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${label} 응답 오류(${res.status})`);
    return (await res.json()).items || [];
  }

  async function loadStudent() {
    const rows = await loadFeed(STUDENT_FEED, '학생 상담 앱');
    return rows
      .filter((b) => inPeriod('student', b.date))
      .map((b) => ({
        kind: 'student',
        date: b.date,
        start: b.slot.split('-')[0],
        tag: b.tag,
        number: b.number,
        method: '',
        done: b.status === 'completed'
      }));
  }

  async function loadParent() {
    const rows = await loadFeed(PARENT_FEED, '학부모 상담 앱');
    return rows
      .filter((r) => inPeriod('parent', r.date))
      .map((r) => ({
        kind: 'parent',
        date: r.date,
        start: r.start,
        tag: r.tag,
        number: r.number,
        method: r.method,
        done: r.status === '상담 완료'
      }));
  }

  function rowHtml(it) {
    const badge = it.kind === 'student' ? '<span class="cs-badge student">학생</span>' : '<span class="cs-badge parent">학부모</span>';
    const method = it.method ? `<span class="cs-method">${escapeHtml(it.method)}</span>` : '';
    return `<li class="cs-row${it.done ? ' done' : ''}">`
      + `<span class="cs-time">${escapeHtml(it.start)}<small>${escapeHtml(it.tag)}</small></span>`
      + `${badge}<span class="cs-who">${it.number ? `${it.number}번` : '번호 없음'}</span>${method}`
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

    let html = errors.map((e) => `<p class="cs-error">${escapeHtml(e)}</p>`).join('');
    html += upcoming.length ? upcoming.map(dayBlock).join('') : '<p class="muted cs-empty">남은 상담 예약이 없습니다.</p>';
    if (past.length) {
      const pastCount = past.reduce((n, d) => n + byDate.get(d).length, 0);
      html += `<details class="cs-past"><summary>지난 상담 ${pastCount}건</summary>${past.reverse().map(dayBlock).join('')}</details>`;
    }
    body.innerHTML = html;
  }

  async function refresh() {
    body.innerHTML = '<p class="muted cs-empty">상담 예약을 불러오는 중입니다.</p>';
    const sources = [['학생 상담', loadStudent()], ['학부모 상담', loadParent()]];
    const results = await Promise.all(sources.map(([label, p]) => p
      .then((items) => ({ items }))
      .catch(() => ({ items: [], error: `${label} 예약을 불러오지 못했습니다. ↻로 다시 시도하세요.` }))));
    const items = results.flatMap((r) => r.items);
    const errors = results.map((r) => r.error).filter(Boolean);
    render(items, errors);
  }

  if (note) note.textContent = PERIODS.map((p) => `${p.label} ${md(p.start)}~${md(p.end)}`).join(' · ');

  document.getElementById('counselRefreshBtn')?.addEventListener('click', refresh);

  panel.classList.remove('hidden');
  refresh();
})();
