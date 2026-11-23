/* 고사 시간표 (학사일정 달력 위)
   데이터는 ../class-notice/data.js의 examSchedules에서만 읽는다. 학생 알림장과 같은 원본이라
   한 곳만 고치면 두 화면이 함께 바뀐다. 전 학년을 날짜 × 교시로 보여주고 우리 반 학년 열을 강조한다.
   시험 마지막 날이 지나면 패널을 숨긴다. */
(function () {
  'use strict';

  const MY_GRADE = 2;
  const panel = document.getElementById('examPanel');
  const body = document.getElementById('examBody');
  const title = document.getElementById('examTitle');
  const note = document.getElementById('examNote');
  if (!panel || !body) return;

  const list = (typeof examSchedules !== 'undefined' && Array.isArray(examSchedules)) ? examSchedules : [];
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const exam = list.find((e) => e.end >= today);
  if (!exam) {
    panel.classList.add('hidden');
    return;
  }

  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const wd = (d) => WD[new Date(`${d}T00:00:00`).getDay()];

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  // 과목이 하나도 없는 학년 열(예: 기말고사 때 3학년)은 숨긴다.
  const shown = [0, 1, 2].filter((g) => exam.days.some((d) => d.slots.some((s) => s.grades[g])));
  const head = panel.querySelector('thead');
  if (head) {
    head.innerHTML = '<tr><th class="exam-date">날짜</th><th class="exam-time">시간</th>'
      + shown.map((g) => `<th${g + 1 === MY_GRADE ? ' class="mine"' : ''}>${g + 1}학년</th>`).join('') + '</tr>';
  }

  body.innerHTML = exam.days.map((day) => day.slots.map((slot, i) => {
    const classes = [];
    if (i === 0) classes.push('day-start');
    if (day.date === today) classes.push('today');
    const dateCell = i === 0
      ? `<td class="exam-date" rowspan="${day.slots.length}">${md(day.date)}<br>(${wd(day.date)})</td>`
      : '';
    const grades = shown.map((g) => {
      const subject = slot.grades[g] || '';
      const cls = g + 1 === MY_GRADE ? ' class="mine"' : '';
      return `<td${cls}>${subject ? escapeHtml(subject) : "·"}</td>`;
    }).join('');
    return `<tr class="${classes.join(' ')}">${dateCell}<td class="exam-time">${escapeHtml(slot.start)}<br>${escapeHtml(slot.end)}</td>${grades}</tr>`;
  }).join('')).join('');

  // "2학기 중간고사"와 "시간표"를 각각 한 덩어리로 묶어, 줄이 넘치면 그 사이에서만 줄바꿈한다.
  if (title) title.innerHTML = `<span class="exam-title-sub">${escapeHtml(exam.title)}</span> <span class="exam-title-sub">시간표</span>`;
  if (note) note.textContent = `${md(exam.start)}(${wd(exam.start)}) ~ ${md(exam.end)}(${wd(exam.end)})`;
  panel.classList.remove('hidden');
})();
