/* 고사 기간 중 연수 계획 (고사 시간표 아래, 학사일정 달력 위)
   교사 화면 전용. 데이터는 아래 TRAINING 한 곳만 고치면 된다.
   마지막 날이 지나면 패널을 숨긴다.
   memo: 주제 아래 작은 글씨 안내 / off: 실제로 운영하지 않는 연수(흐리게, 시정표에서 제외) */
(function () {
  'use strict';

  const TRAINING = {
    title: '2026학년도 2학기 기말고사 기간 중 연수 계획',
    start: '2026-12-10',
    end: '2026-12-16',
    rows: [
      { date: '2026-12-10', topic: '생활기록부 기재요령 연수', time: '13:00', host: '교무부', place: '시청각실' },
      { date: '2026-12-10', topic: '교사 대상 학생 인권 교육', time: '13:00 ~ 15:00', host: '생활안전부', place: '시청각실', off: true,
        memo: '실제 운영 안 함 · 필수 연수(2시간)라 조퇴 등 근무상신은 15:00 이후로 · 12월 교직원회의 때 학교폭력 예방교육과 함께 실시' },
      { date: '2026-12-11', topic: 'AI 활용 사례 나눔 공유 및 전교직원 연수', time: '11:00 ~ 점심 식사 후', host: '연구부', place: '시청각실 및 청량리 홍릉 일대', mark: true,
        memo: '수업 사례 공유(국·영·수·사·과·예술) → 청량리 뷔페 점심 후 종료 · 증빙 사진 촬영 · 별도 조퇴 등 근무상황 신청 불필요' },
      { date: '2026-12-14', topic: '2026학년도 교육활동 평가회', time: '13:00 ~ 16:00', host: '연구부', place: '교장실' },
      { date: '2026-12-15', topic: '교원학습공동체', time: '13:00 ~ 16:00', host: '연구부', place: '각 장소' },
      { date: '2026-12-16', topic: '교원학습공동체', time: '13:00 ~ 16:00', host: '연구부', place: '각 장소' }
    ]
  };

  // 개인 알림장의 고사 기간 시정표(app.js examBellFor)가 오후 연수 시각을 여기서 읽는다.
  window.TRAINING_SCHEDULE = TRAINING;

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
    if (row.off) classes.push('off');
    if (row.date === today) classes.push('today');
    let dateCell = '';
    if (!drawn.has(row.date)) {
      drawn.add(row.date);
      dateCell = `<td class="exam-date" rowspan="${span.get(row.date)}">${md(row.date)}<br>(${wd(row.date)})</td>`;
    }
    return `<tr class="${classes.join(' ')}">${dateCell}`
      + `<td class="train-topic">${escapeHtml(row.topic)}${row.memo ? `<div class="train-memo">${escapeHtml(row.memo)}</div>` : ''}</td>`
      + `<td class="exam-time">${escapeHtml(row.time)}</td>`
      + `<td class="train-host">${escapeHtml(row.host)}</td>`
      + `<td>${escapeHtml(row.place)}</td></tr>`;
  }).join('');

  if (note) note.textContent = `${md(TRAINING.start)}(${wd(TRAINING.start)}) ~ ${md(TRAINING.end)}(${wd(TRAINING.end)})`;
  panel.classList.remove('hidden');
})();
