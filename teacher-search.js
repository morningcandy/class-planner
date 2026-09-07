/* 선생님 시간표 검색 · 공통 공강 찾기
   데이터는 teacher-timetable.js(window.TEACHER_TIMETABLE)에서만 읽는다.
   한 명이면 주간 시간표와 지금 상태, 두 명 이상이면 모두 비는 요일·교시를 보여준다. */
(function () {
  'use strict';

  const DATA = window.TEACHER_TIMETABLE;
  if (!DATA || !DATA.teachers) return;

  const DAYS = DATA.meta.days;
  const PERIODS = DATA.meta.periods;
  /* 정규 시정표 기준. 단축·행사 시정표에는 "지금" 표시가 맞지 않을 수 있어
     안내 문구로 그 점을 밝힌다. */
  const TIMES = [
    ['08:20', '09:10'], ['09:20', '10:10'], ['10:20', '11:10'], ['11:20', '12:10'],
    ['13:10', '14:00'], ['14:10', '15:00'], ['15:10', '16:00'],
  ];

  const NAMES = Object.keys(DATA.teachers);
  const input = document.getElementById('teacherQuery');
  const list = document.getElementById('teacherNames');
  const result = document.getElementById('teacherResult');
  const note = document.getElementById('teacherNote');
  if (!input || !result) return;

  if (note) note.textContent = `${DATA.meta.semester} · ${NAMES.length}명`;
  if (list) list.innerHTML = NAMES.map((name) => `<option value="${name}"></option>`).join('');

  const slotOf = (name, day, period) => DATA.teachers[name][day * PERIODS + (period - 1)] || '';

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  /* "104 국어A" → 과목을 앞에 세운다. 사용자는 무슨 수업인지를 먼저 본다. */
  function slotLabel(slot) {
    const [room, subject] = slot.split(' ');
    return { room, subject: subject || '', text: `${subject || ''} ${room}`.trim() };
  }

  /* 쉼표·공백·가운뎃점 아무거나로 끊어도 이름 목록으로 읽는다. */
  function parseNames(raw) {
    const chunks = String(raw).split(/[,\s·、/+]+/).map((s) => s.trim()).filter(Boolean);
    const found = [];
    const missing = [];
    chunks.forEach((chunk) => {
      if (DATA.teachers[chunk]) {
        if (!found.includes(chunk)) found.push(chunk);
        return;
      }
      const partial = NAMES.filter((name) => name.indexOf(chunk) >= 0);
      if (partial.length === 1) {
        if (!found.includes(partial[0])) found.push(partial[0]);
      } else {
        missing.push({ chunk, candidates: partial.slice(0, 6) });
      }
    });
    return { found, missing };
  }

  /* 오늘·지금이 몇 교시인지. 수업 시간이 아니면 null. */
  function nowSlot() {
    const now = new Date();
    const day = now.getDay() - 1; // 0=월
    if (day < 0 || day > 4) return { day: -1, period: 0 };
    const minutes = now.getHours() * 60 + now.getMinutes();
    for (let i = 0; i < TIMES.length; i += 1) {
      const [start, end] = TIMES[i];
      const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
      if (minutes >= toMin(start) && minutes <= toMin(end)) return { day, period: i + 1 };
    }
    return { day, period: 0 };
  }

  function missingHtml(missing) {
    if (!missing.length) return '';
    return missing.map((item) => {
      const hint = item.candidates.length
        ? ` 혹시 ${item.candidates.map(escapeHtml).join(' · ')}?`
        : '';
      return `<p class="teacher-miss">‘${escapeHtml(item.chunk)}’ 선생님은 시간표에 없습니다.${hint}</p>`;
    }).join('');
  }

  /* 한 명: 지금 상태 + 주간 시간표 */
  function renderOne(name) {
    const { day, period } = nowSlot();
    let status;
    if (day < 0) {
      status = '<span class="teacher-status off">주말 · 수업 없음</span>';
    } else if (!period) {
      status = `<span class="teacher-status off">지금은 수업 시간이 아닙니다 (${DAYS[day]}요일)</span>`;
    } else {
      const slot = slotOf(name, day, period);
      status = slot
        ? `<span class="teacher-status busy">지금 ${DAYS[day]} ${period}교시 · 수업 중 — ${escapeHtml(slotLabel(slot).text)}</span>`
        : `<span class="teacher-status free">지금 ${DAYS[day]} ${period}교시 · 공강</span>`;
    }

    let rows = '';
    for (let p = 1; p <= PERIODS; p += 1) {
      const cells = DAYS.map((_, d) => {
        const slot = slotOf(name, d, p);
        if (!slot) return '<td class="free">공강</td>';
        const label = slotLabel(slot);
        return `<td class="busy"><b>${escapeHtml(label.subject)}</b><br>${escapeHtml(label.room)}</td>`;
      }).join('');
      const current = (day >= 0 && period === p) ? ' class="current"' : '';
      rows += `<tr${current}><td>${p}</td><td class="tt-time">${TIMES[p - 1][0]}<br>${TIMES[p - 1][1]}</td>${cells}</tr>`;
    }

    const load = DATA.teachers[name].filter(Boolean).length;
    return `${status}
      <div class="teacher-tt-wrap">
        <table class="timetable teacher-tt">
          <thead><tr><th>교시</th><th>시간</th>${DAYS.map((d) => `<th>${d}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="teacher-foot">${escapeHtml(name)} 선생님 · 주 ${load}시수 · 공강 ${PERIODS * DAYS.length - load}칸</p>`;
  }

  /* 여러 명: 모두 비는 칸만 초록으로, 아래에 요일별 목록 */
  function renderMany(names) {
    const common = [];
    let rows = '';
    for (let p = 1; p <= PERIODS; p += 1) {
      const cells = DAYS.map((_, d) => {
        const busy = names.filter((name) => slotOf(name, d, p));
        if (!busy.length) {
          common.push({ day: d, period: p });
          return '<td class="all-free">전원 공강</td>';
        }
        const who = busy.map((name) => `${name} ${slotLabel(slotOf(name, d, p)).text}`).join(', ');
        return `<td class="busy-some" title="${escapeHtml(who)}">${busy.length}명 수업</td>`;
      }).join('');
      rows += `<tr><td>${p}</td><td class="tt-time">${TIMES[p - 1][0]}<br>${TIMES[p - 1][1]}</td>${cells}</tr>`;
    }

    let summary;
    if (!common.length) {
      summary = `<p class="teacher-miss">${escapeHtml(names.join(' · '))} 선생님이 모두 비는 교시가 없습니다. 인원을 줄여서 다시 찾아보세요.</p>`;
    } else {
      const byDay = DAYS.map((label, d) => {
        const periods = common.filter((slot) => slot.day === d).map((slot) => `${slot.period}교시`);
        return periods.length ? `<li><b>${label}</b> ${periods.join(' · ')}</li>` : '';
      }).join('');
      summary = `<p class="teacher-status free">${escapeHtml(names.join(' · '))} 선생님 ${names.length}명 공통 공강 ${common.length}칸</p>
        <ul class="teacher-common">${byDay}</ul>`;
    }

    return `${summary}
      <div class="teacher-tt-wrap">
        <table class="timetable teacher-tt">
          <thead><tr><th>교시</th><th>시간</th>${DAYS.map((d) => `<th>${d}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="teacher-foot">칸에 마우스를 올리면 누가 무슨 수업인지 보입니다.</p>`;
  }

  function render() {
    const raw = input.value.trim();
    if (!raw) {
      result.innerHTML = '<p class="teacher-hint">이름을 입력하면 그 선생님의 주간 시간표와 지금 상태를 보여줍니다. 쉼표로 여러 명을 넣으면 모두 비는 요일·교시를 찾아줍니다. (예: 김현아, 송진규)</p>';
      return;
    }
    const { found, missing } = parseNames(raw);
    if (!found.length) {
      result.innerHTML = missingHtml(missing) || '<p class="teacher-miss">찾는 이름이 없습니다.</p>';
      return;
    }
    const body = found.length === 1 ? renderOne(found[0]) : renderMany(found);
    result.innerHTML = missingHtml(missing) + body;
  }

  input.addEventListener('input', render);
  render();
  /* 교시가 넘어가면 "지금" 표시도 따라간다. */
  setInterval(() => { if (input.value.trim()) render(); }, 60000);
}());
