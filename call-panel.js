/* 학생 호출 패널
   번호를 고르고 [호출]을 눌러야 교실 컴퓨터에 띄워둔 호출 화면(class-notice/board/)에 뜬다.
   번호만 잘못 눌러도 호출이 나가지 않도록 선택과 호출을 나눴다.
   명단과 오늘 호출은 app.js가 보내는 'planner:data' 이벤트로만 받는다. */
(function () {
  'use strict';

  const CONFIG = window.CLASS_PLANNER_CONFIG || {};
  const API_URL = CONFIG.apiUrl || '';
  const AUTH_KEY = 'classPlanner.adminToken.v3';

  const panel = document.getElementById('callPanel');
  const numbers = document.getElementById('callNumbers');
  const reasonInput = document.getElementById('callReason');
  const todayBox = document.getElementById('callToday');
  const hint = document.getElementById('callHint');
  const picked = document.getElementById('callPicked');
  const goButton = document.getElementById('callGo');
  const clearButton = document.getElementById('callClear');
  if (!panel || !numbers) return;

  const state = { students: [], calls: [], busy: false, selected: null };
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);

  async function api(action, payload) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({
        action: action,
        token: sessionStorage.getItem(AUTH_KEY) || '',
      }, payload || {})),
    });
    if (!response.ok) throw new Error('서버 연결 실패 (' + response.status + ')');
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || '요청을 처리하지 못했습니다.');
    return result;
  }

  function activeCallOf(number) {
    return state.calls.find(function (call) {
      return Number(call.number) === Number(number) && call.status === '호출중';
    });
  }

  function render() {
    numbers.innerHTML = state.students.map(function (student) {
      const number = Number(student.number);
      const call = activeCallOf(number);
      const selected = state.selected === number;
      return '<button type="button" class="call-num' + (call ? ' calling' : '') + (selected ? ' selected' : '') + '"' +
        ' aria-pressed="' + selected + '"' +
        ' data-number="' + esc(number) + '"' +
        ' title="' + esc(call ? (call.reason || '호출 중') : (student.name || '')) + '">' +
        esc(number) + '</button>';
    }).join('');

    /* 취소한 호출은 시트에 기록만 남고 화면에서는 사라진다. 거르지 않으면
       다음 새로고침 때 "호출 중"으로 되살아나 취소가 안 먹힌 것처럼 보인다. */
    const today = state.calls.filter(function (call) {
      return call.status !== '취소';
    }).sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    todayBox.innerHTML = today.length ? today.map(function (call) {
      const done = call.status === '전달완료';
      return '<span class="call-chip' + (done ? ' done' : '') + '">' +
        esc(call.number) + '번' +
        (call.reason ? ' · ' + esc(call.reason) : '') +
        ' · ' + (done ? '전달 완료' : '호출 중') +
        (done ? '' : ' <button type="button" class="call-cancel" data-cancel="' + esc(call.id) + '">취소</button>') +
        '</span>';
    }).join('') : '<span class="muted hint-sm">오늘 호출 없음</span>';
    renderActions();
  }

  function renderActions() {
    if (!picked) return;
    const number = state.selected;
    const student = state.students.find(function (item) { return Number(item.number) === number; });
    picked.textContent = number == null
      ? '번호를 골라주세요'
      : number + '번' + (student && student.name ? ' ' + student.name : '') + ' 선택됨' +
        (activeCallOf(number) ? ' · 이미 호출 중' : '');
    if (goButton) goButton.disabled = number == null || state.busy;
    if (clearButton) clearButton.disabled = number == null || state.busy;
  }

  async function call(number) {
    if (state.busy || number == null) return;
    state.busy = true;
    renderActions();
    try {
      const result = await api('createCall', {
        call: { number: number, reason: reasonInput.value.trim(), caller: '담임T' },
      });
      reasonInput.value = '';
      state.calls = state.calls.filter(function (item) {
        return String(item.id) !== String(result.call.id);
      }).concat([result.call]);
      hint.textContent = number + '번 호출을 교실 화면에 띄웠습니다.';
      state.selected = null;
      render();
    } catch (error) {
      hint.textContent = error.message;
    } finally {
      state.busy = false;
      renderActions();
    }
  }

  async function cancel(callId) {
    if (state.busy) return;
    state.busy = true;
    try {
      await api('cancelCall', { callId: callId });
      state.calls = state.calls.map(function (item) {
        return String(item.id) === String(callId) ? Object.assign({}, item, { status: '취소' }) : item;
      });
      hint.textContent = '호출을 취소했습니다.';
      render();
    } catch (error) {
      hint.textContent = error.message;
    } finally {
      state.busy = false;
    }
  }

  /* 번호는 고르기만 한다. 같은 번호를 다시 누르면 선택이 풀린다. */
  numbers.addEventListener('click', function (event) {
    const button = event.target.closest('.call-num');
    if (!button) return;
    const number = Number(button.dataset.number);
    state.selected = state.selected === number ? null : number;
    render();
  });

  if (goButton) goButton.addEventListener('click', function () { call(state.selected); });
  if (clearButton) clearButton.addEventListener('click', function () {
    state.selected = null;
    hint.textContent = '선택을 취소했습니다. 호출은 보내지 않았습니다.';
    render();
  });

  todayBox.addEventListener('click', function (event) {
    const button = event.target.closest('.call-cancel');
    if (button) cancel(button.dataset.cancel);
  });

  document.addEventListener('planner:data', function (event) {
    const detail = event.detail || {};
    state.students = (detail.students || []).filter(function (student) {
      return student.active !== false && Number(student.number) > 0;
    }).sort(function (a, b) { return Number(a.number) - Number(b.number); });
    state.calls = detail.calls || [];
    if (!detail.boardReady) {
      hint.textContent = '교실 화면 코드가 아직 설정되지 않았습니다. 시트 메뉴 → 학급 플래너 → 5번에서 설정하세요.';
    }
    render();
  });
})();
