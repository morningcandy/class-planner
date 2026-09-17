/* 중간고사 기간 중 연수 계획 (고사 시간표 아래)
   교사 화면 전용. 데이터는 아래 TRAINING 한 곳만 고치면 된다.
   마지막 날이 지나면 패널을 숨긴다. */
(function () {
  'use strict';

  const TRAINING = {
    title: '2026학년도 2학기 중간고사 기간 중 연수 계획',
    start: '2026-10-13',
    end: '2026-10-16',
    rows: [
      { date: '2026-10-13', topic: '동대문 소방서 합동 훈련', time: '13:00 ~ 14:00', host: '행정실', place: '본교 운동장', mark: true },
      { date: '2026-10-13', topic: '교원학습공동체의 날', time: '14:00 ~ 16:00', host: '공동체별', place: '각 배정 장소' },
      { date: '2026-10-14', topic: '전교직원 워크숍', time: '13:00 ~ 18:00', host: '연구부', place: '이태원 일대', mark: true },
      { date: '2026-10-15', topic: '교원학습공동체의 날', time: '13:00 ~ 16:00', host: '공동체별', place: '각 배정 장소' },
      { date: '2026-10-16', topic: '교원학습공동체의 날', time: '13:00 ~ 16:00', host: '공동체별', place: '각 배정 장소' }
    ]
  };

  const panel = document.getElementById('trainPanel');
  const body = document.getElementById('trainBody');
  const note = document.getElementById('trainNote');
  if (!panel || !body) return;

  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (TRAINING.end < today) {
    panel.classList.add('hidden');
    return;
  }

  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const wd = (d) => WD[new Date(`${d}T00:00:00`).getDay()];

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  // 같은 날짜가 이어지면 첫 줄에만 날짜 칸을 두고 rowspan으로 묶는다.
  const span = new Map();
  TRAINING.rows.forEach((row) => span.set(row.date, (span.get(row.date) || 0) + 1));
  const drawn = new Set();

  body.innerHTML = TRAINING.rows.map((row) => {
    const classes = [];
    if (!drawn.has(row.date)) classes.push('day-start');
    if (row.mark) classes.push('mark');
    if (row.date === today) classes.push('today');
    let dateCell = '';
    if (!drawn.has(row.date)) {
      drawn.add(row.date);
      dateCell = `<td class="exam-date" rowspan="${span.get(row.date)}">${md(row.date)}<br>(${wd(row.date)})</td>`;
    }
    return `<tr class="${classes.join(' ')}">${dateCell}`
      + `<td class="train-topic">${escapeHtml(row.topic)}</td>`
      + `<td class="exam-time">${escapeHtml(row.time)}</td>`
      + `<td class="train-host">${escapeHtml(row.host)}</td>`
      + `<td>${escapeHtml(row.place)}</td></tr>`;
  }).join('');

  if (note) note.textContent = `${md(TRAINING.start)}(${wd(TRAINING.start)}) ~ ${md(TRAINING.end)}(${wd(TRAINING.end)})`;
  panel.classList.remove('hidden');
})();
