(() => {
  'use strict';

  const CONFIG = window.CLASS_PLANNER_CONFIG || {};
  const API_URL = CONFIG.apiUrl || '';
  const AUTH_KEY = 'classPlanner.adminToken.v3';
  const LEGACY_KEY = 'classPlanner.schedule.v2';
  const LEGACY_DONE_KEY = 'classPlanner.legacyImported.v3';
  const CLAUDE_URL_KEY = 'classPlanner.claudeBridgeUrl.v1';
  const CLAUDE_ACCESS_KEY = 'classPlanner.claudeBridgeAccessKey.v1';
  const state = {
    token: sessionStorage.getItem(AUTH_KEY) || '',
    plannerItems: [],
    notices: [],
    students: [],
    category: '전체',
    noticeStatus: '검토대기',
    calendarDate: new Date(),
    selectedDate: '',
    loading: false,
    claudeMessages: [],
    claudeDraft: '',
    claudeFiles: [],
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function today() {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function datePlus(base, days) {
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + days);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function dateLabel(value) {
    if (!value) return '날짜 미정';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
    return `${date.getMonth() + 1}월 ${date.getDate()}일(${weekday})`;
  }

  function categoryClass(category) {
    return category === '학급' ? 'class' : category === '교과' ? 'subject' : 'personal';
  }

  function truthy(value) {
    return value === true || /^(true|1|yes|사용|활성)$/i.test(String(value || ''));
  }

  async function api(action, payload = {}) {
    if (!API_URL) throw new Error('config.js에 Apps Script 주소를 입력해주세요.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: state.token, ...payload }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`서버 응답 오류 (${response.status})`);
      const result = await response.json();
      if (!result || !result.ok) throw new Error(result?.error || '요청을 처리하지 못했습니다.');
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('연결 시간이 초과되었습니다. Apps Script 배포 상태를 확인해주세요.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add('hidden'), 2800);
  }

  function showConnectionError(error) {
    const banner = $('connectionBanner');
    banner.textContent = `구글 시트 연결을 확인해주세요: ${error.message || error}`;
    banner.classList.remove('hidden');
  }

  function clearConnectionError() {
    $('connectionBanner').classList.add('hidden');
  }

  function setClaudeState(label, type = 'pending') {
    const badge = $('claudeState');
    badge.textContent = label;
    badge.className = `ai-state ${type}`;
  }

  function normalizeBridgeUrl(value) {
    const text = String(value || '').trim().replace(/\/+$/, '');
    if (!text) throw new Error('Claude 브리지 서버 주소를 입력해주세요.');
    let url;
    try { url = new URL(text); }
    catch { throw new Error('Claude 브리지 주소 형식을 확인해주세요.'); }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) {
      throw new Error('배포 서버는 HTTPS 주소를 사용해야 합니다.');
    }
    return url.toString().replace(/\/$/, '');
  }

  function saveBridgeSettings() {
    const url = normalizeBridgeUrl($('claudeBridgeUrl').value);
    const key = $('claudeBridgeKey').value.trim();
    if (key.length < 16) throw new Error('브리지 접속키는 16자 이상으로 입력해주세요.');
    localStorage.setItem(CLAUDE_URL_KEY, url);
    sessionStorage.setItem(CLAUDE_ACCESS_KEY, key);
    return { url, key };
  }

  async function bridgeRequest(pathname, options = {}) {
    const { url, key } = saveBridgeSettings();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 150000);
    try {
      const response = await fetch(`${url}${pathname}`, {
        method: options.method || 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': key },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      let result;
      try { result = await response.json(); }
      catch { throw new Error(`Claude 브리지 응답을 읽지 못했습니다. (${response.status})`); }
      if (!response.ok || !result.ok) throw new Error(result.error || `Claude 브리지 오류 (${response.status})`);
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Claude 응답 시간이 초과되었습니다.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function renderClaudeFiles() {
    const box = $('claudeFileList');
    box.classList.toggle('hidden', !state.claudeFiles.length);
    box.innerHTML = state.claudeFiles.map((file, index) => `<span class="attachment-file">${escapeHtml(file.name)} · ${(file.size / 1024 / 1024).toFixed(1)}MB<button type="button" data-remove-file="${index}" aria-label="첨부 삭제">×</button></span>`).join('');
  }

  function filePayload(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, data: String(reader.result || '').split(',')[1] || '' });
      reader.onerror = () => reject(new Error(`${file.name} 파일을 읽지 못했습니다.`));
      reader.readAsDataURL(file);
    });
  }

  function renderClaudeMessages(thinking = false) {
    const messages = state.claudeMessages.length ? state.claudeMessages : [{
      role: 'assistant',
      content: '전달사항이나 쿨메신저 내용을 붙여넣고 원하는 정리 방법을 말씀해주세요. 결과를 확인한 뒤 알림장에 반영할 수 있습니다.',
    }];
    const rows = messages.map((message) => {
      const assistant = message.role === 'assistant';
      return `<article class="claude-message ${assistant ? 'assistant' : 'user'}">
        <div class="message-avatar">${assistant ? 'C' : '나'}</div>
        <div><strong>${assistant ? 'Claude' : '교사'}</strong><p>${escapeHtml(message.content)}</p></div>
      </article>`;
    });
    if (thinking) rows.push(`<article class="claude-message assistant thinking"><div class="message-avatar">C</div><div><strong>Claude</strong><p class="thinking-dots">내용을 정리하고 있습니다</p></div></article>`);
    const box = $('claudeMessages');
    box.innerHTML = rows.join('');
    box.scrollTop = box.scrollHeight;
  }

  function resetClaudeChat() {
    state.claudeMessages = [];
    state.claudeDraft = '';
    state.claudeFiles = [];
    $('claudePrompt').value = '';
    $('claudeFiles').value = '';
    $('claudeApplyText').value = '';
    $('claudeDraft').classList.add('hidden');
    $('claudeApplyResult').classList.add('hidden');
    renderClaudeFiles();
    renderClaudeMessages();
  }

  async function ingestText(rawText, button, resultBox, action = 'ingest') {
    if (!rawText) throw new Error('반영할 내용을 입력해주세요.');
    const idleLabel = button.textContent;
    button.disabled = true;
    button.textContent = '반영 중…';
    try {
      const result = await api(action, { rawText });
      resultBox.className = `result-message${result.warning ? ' warning' : ''}`;
      resultBox.textContent = `개인 알림장 ${result.plannerItems.length}건, 공지 검토함 ${result.notices.length}건을 만들었습니다.${result.warning ? ` ${result.warning}` : ''}`;
      await loadAdminData();
      if (result.notices.length) $('reviewPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return result;
    } finally {
      button.disabled = false;
      button.textContent = idleLabel;
    }
  }

  async function loadAdminData() {
    const data = await api('adminLoad');
    state.plannerItems = Array.isArray(data.plannerItems) ? data.plannerItems : [];
    state.notices = Array.isArray(data.notices) ? data.notices : [];
    state.students = Array.isArray(data.students) ? data.students : [];
    $('updatedAt').textContent = `마지막 동기화 ${new Date(data.updatedAt || Date.now()).toLocaleString('ko-KR')}`;
    clearConnectionError();
    renderAll();
    detectLegacySchedule();
  }

  function legacySchedule() {
    if (localStorage.getItem(LEGACY_DONE_KEY)) return [];
    try {
      const value = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
      return Array.isArray(value) ? value.filter((item) => item && item.title) : [];
    } catch { return []; }
  }

  function detectLegacySchedule() {
    const items = legacySchedule();
    $('legacyBanner').classList.toggle('hidden', !items.length);
    $('legacyMessage').textContent = items.length ? `이 브라우저에 예전 개인 알림장 일정 ${items.length}건이 남아 있습니다.` : '';
  }

  async function unlock(token) {
    state.token = token;
    $('authMessage').textContent = '구글 시트에 연결하는 중…';
    try {
      await loadAdminData();
      sessionStorage.setItem(AUTH_KEY, token);
      $('authScreen').classList.add('hidden');
      $('app').classList.remove('hidden');
      $('authMessage').textContent = '';
    } catch (error) {
      state.token = '';
      sessionStorage.removeItem(AUTH_KEY);
      $('authMessage').textContent = error.message;
    }
  }

  function lock() {
    state.token = '';
    sessionStorage.removeItem(AUTH_KEY);
    $('tokenInput').value = '';
    $('app').classList.add('hidden');
    $('authScreen').classList.remove('hidden');
    $('tokenInput').focus();
  }

  function renderSummary() {
    const now = today();
    const weekEnd = datePlus(now, 7);
    const active = state.plannerItems.filter((item) => item.status !== '완료');
    $('dueCount').textContent = active.filter((item) => item.due_date && item.due_date <= now).length;
    $('weekCount').textContent = active.filter((item) => {
      const date = item.date || item.due_date;
      return date && date >= now && date <= weekEnd;
    }).length;
    $('reviewCount').textContent = state.notices.filter((notice) => notice.status === '검토대기').length;
    $('publishedCount').textContent = state.notices.filter((notice) => notice.status === '게시됨').length;
    $('reviewBadge').textContent = state.notices.filter((notice) => notice.status === '검토대기').length;
  }

  function targetNames(notice) {
    if (notice.scope === '학급전체') return '학급 전체';
    const ids = String(notice.target_student_ids || '').split(',').map((id) => id.trim()).filter(Boolean);
    const names = ids.map((id) => state.students.find((student) => String(student.student_id) === id))
      .filter(Boolean).map((student) => `${student.number}번 ${student.name}`);
    return names.length ? names.join(', ') : '대상 학생 확인 필요';
  }

  function noticeCard(notice) {
    const classes = ['notice-row'];
    if (notice.scope === '학생개별') classes.push('personal');
    if (notice.status === '게시됨') classes.push('published');
    const mainDate = notice.notice_type === '할일' ? notice.due_date : notice.notice_date;
    const statusActions = notice.status === '검토대기'
      ? `<button class="hold" data-notice-action="hold" data-id="${escapeHtml(notice.notice_id)}">보류</button><button class="publish" data-notice-action="publish" data-id="${escapeHtml(notice.notice_id)}">게시하기</button>`
      : notice.status === '게시됨'
        ? `<button data-notice-action="close" data-id="${escapeHtml(notice.notice_id)}">게시 종료</button>`
        : `<button data-notice-action="review" data-id="${escapeHtml(notice.notice_id)}">다시 검토</button>`;
    return `
      <article class="${classes.join(' ')}">
        <div class="row-top">
          <div>
            <h3 class="row-title">${escapeHtml(notice.title)}</h3>
            <p class="row-note">${escapeHtml(notice.content || '')}</p>
            <div class="row-meta">
              <span class="tag ${notice.scope === '학생개별' ? 'personal' : 'class'}">${escapeHtml(targetNames(notice))}</span>
              <span class="tag">${escapeHtml(notice.notice_type || '공지')}</span>
              ${truthy(notice.urgent) ? '<span class="tag urgent">중요</span>' : ''}
              <span class="tag">${escapeHtml(notice.status)}</span>
            </div>
          </div>
          <span class="date-label">${escapeHtml(dateLabel(mainDate))}</span>
        </div>
        <div class="row-bottom">
          <span class="muted" style="font-size:11px">학생 화면에는 ‘게시됨’ 상태만 표시됩니다.</span>
          <span class="spacer"></span>
          <div class="row-actions">
            <button data-notice-action="edit" data-id="${escapeHtml(notice.notice_id)}">수정</button>
            ${statusActions}
          </div>
        </div>
      </article>`;
  }

  function renderNotices() {
    const list = state.notices
      .filter((notice) => notice.status === state.noticeStatus)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    $('noticeList').innerHTML = list.length
      ? list.map(noticeCard).join('')
      : `<div class="empty-state">${escapeHtml(state.noticeStatus)} 상태의 공지가 없습니다.</div>`;
  }

  function plannerCard(item) {
    const date = item.due_date || item.date;
    const isDone = item.status === '완료';
    const linked = String(item.linked_notice_ids || '').trim();
    return `
      <article class="planner-row ${isDone ? 'done' : ''}">
        <input class="complete-check" type="checkbox" data-item-action="toggle" data-id="${escapeHtml(item.item_id)}" ${isDone ? 'checked' : ''} aria-label="완료">
        <div>
          <h3 class="row-title">${escapeHtml(item.title)}</h3>
          ${item.note ? `<p class="row-note">${escapeHtml(item.note)}</p>` : ''}
          <div class="row-meta">
            <span class="tag ${categoryClass(item.category)}">${escapeHtml(item.category)}</span>
            <span class="tag">${escapeHtml(item.item_type || '업무')}</span>
            ${item.priority === '높음' ? '<span class="tag urgent">중요</span>' : ''}
            ${linked ? '<span class="tag class">학급 공지 연결</span>' : ''}
            <span class="tag">${escapeHtml(item.status || '진행')}</span>
          </div>
        </div>
        <div class="row-actions">
          <span class="date-label">${escapeHtml(dateLabel(date))}</span>
          <button data-item-action="edit" data-id="${escapeHtml(item.item_id)}">수정</button>
          <button class="danger" data-item-action="delete" data-id="${escapeHtml(item.item_id)}">삭제</button>
        </div>
      </article>`;
  }

  function renderPlanner() {
    const items = state.plannerItems
      .filter((item) => state.category === '전체' || item.category === state.category)
      .sort((a, b) => {
        if ((a.status === '완료') !== (b.status === '완료')) return a.status === '완료' ? 1 : -1;
        return String(a.due_date || a.date || '9999').localeCompare(String(b.due_date || b.date || '9999'));
      });
    $('plannerList').innerHTML = items.length
      ? items.map(plannerCard).join('')
      : '<div class="empty-state">이 분류에 등록된 일정이 없습니다.</div>';
  }

  function itemsOn(date) {
    return state.plannerItems.filter((item) => item.date === date || item.due_date === date);
  }

  function schoolEntriesOn(date) {
    const entries = [];
    if (typeof calendarEvents !== 'undefined') {
      calendarEvents.filter((event) => event.date === date).forEach((event) => entries.push({ type: '학사', title: event.title }));
    }
    if (typeof holidays !== 'undefined') {
      holidays.filter((event) => event.date === date).forEach((event) => entries.push({ type: '휴일', title: event.title }));
    }
    return entries;
  }

  function rangeFor(date, sourceName) {
    const source = sourceName === 'special'
      ? (typeof specialRanges !== 'undefined' ? specialRanges : [])
      : (typeof vacationRanges !== 'undefined' ? vacationRanges : []);
    return source.find((range) => date >= range.start && date <= range.end) || null;
  }

  function calendarEntriesOn(date) {
    const special = rangeFor(date, 'special');
    const vacation = rangeFor(date, 'vacation');
    return schoolEntriesOn(date).concat(
      special ? [{ type: '학교', title: special.title }] : [],
      vacation ? [{ type: '학교', title: vacation.title }] : [],
      itemsOn(date).map((item) => ({ type: item.category, title: item.title })),
    );
  }

  function calendarEntryClass(type) {
    if (type === '학급') return 'class';
    if (type === '교과' || type === '학사') return 'subject';
    if (type === '개인') return 'personal';
    return 'school';
  }

  function renderCalendar() {
    const base = state.calendarDate;
    const year = base.getFullYear();
    const month = base.getMonth();
    $('calendarTitle').textContent = `${year}년 ${month + 1}월`;
    const headers = ['일', '월', '화', '수', '목', '금', '토'].map((day) => `<div class="cal-dow">${day}</div>`).join('');
    const firstDay = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < firstDay; i += 1) cells += '<div class="cal-cell blank"></div>';
    for (let day = 1; day <= lastDay; day += 1) {
      const date = [year, String(month + 1).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
      const weekday = new Date(year, month, day).getDay();
      const classes = ['cal-cell'];
      const schoolEntries = schoolEntriesOn(date);
      const special = rangeFor(date, 'special');
      const vacation = rangeFor(date, 'vacation');
      const entries = calendarEntriesOn(date);
      if (date === today()) classes.push('today');
      if (date === state.selectedDate) classes.push('selected');
      if (itemsOn(date).length) classes.push('has-item');
      if (schoolEntries.length) classes.push('school');
      if (special?.type === 'exam') classes.push('exam');
      if (special?.type === 'prep') classes.push('prep');
      if (vacation) classes.push('vacation');
      if (weekday === 0) classes.push('sunday');
      if (weekday === 6) classes.push('saturday');
      const previews = entries.slice(0, 2).map((entry) =>
        `<span class="cal-entry ${calendarEntryClass(entry.type)}">${escapeHtml(entry.title)}</span>`
      ).join('');
      const more = entries.length > 2 ? `<span class="cal-more">+${entries.length - 2}개</span>` : '';
      const label = entries.length ? `${date}: ${entries.map((entry) => entry.title).join(', ')}` : date;
      cells += `<button type="button" class="${classes.join(' ')}" data-calendar-date="${date}" aria-label="${escapeHtml(label)}"><span class="cal-day-number">${day}</span><span class="cal-entry-list">${previews}${more}</span></button>`;
    }
    $('calendarGrid').innerHTML = headers + cells;
    if (state.selectedDate) renderCalendarDetail(state.selectedDate);
    else renderMonthAgenda(year, month);
  }

  function renderCalendarDetail(date) {
    const list = calendarEntriesOn(date);
    $('calendarDetail').innerHTML = list.length
      ? `<strong>${escapeHtml(dateLabel(date))}</strong><br>${list.map((item) => `· [${escapeHtml(item.type)}] ${escapeHtml(item.title)}`).join('<br>')}`
      : `<strong>${escapeHtml(dateLabel(date))}</strong><br>등록된 일정이 없습니다.`;
  }

  function renderMonthAgenda(year, month) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    const rows = [];
    const seenRanges = new Set();
    for (let day = 1; day <= lastDay; day += 1) {
      const date = [year, String(month + 1).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
      calendarEntriesOn(date).forEach((entry) => {
        const rangeKey = entry.type === '학교' ? `${entry.type}:${entry.title}` : '';
        if (rangeKey && seenRanges.has(rangeKey)) return;
        if (rangeKey) seenRanges.add(rangeKey);
        rows.push({ date, ...entry });
      });
    }
    $('calendarDetail').innerHTML = rows.length
      ? `<strong>이번 달 전체 일정</strong><div class="month-agenda">${rows.map((entry) => `<div><time>${escapeHtml(dateLabel(entry.date))}</time><span class="tag ${calendarEntryClass(entry.type)}">${escapeHtml(entry.type)}</span><span>${escapeHtml(entry.title)}</span></div>`).join('')}</div>`
      : '<strong>이번 달 전체 일정</strong><br>등록된 일정이 없습니다.';
  }

  function renderAll() {
    renderSummary();
    renderNotices();
    renderPlanner();
    renderCalendar();
  }

  function openModal(id) { $(id).classList.remove('hidden'); }
  function closeModal(id) { $(id).classList.add('hidden'); }

  function openItemEditor(itemId = '') {
    const item = state.plannerItems.find((entry) => String(entry.item_id) === String(itemId));
    $('itemModalTitle').textContent = item ? '일정 수정' : '일정 추가';
    $('itemId').value = item?.item_id || '';
    $('itemCategory').value = item?.category || '학급';
    $('itemType').value = item?.item_type || '업무';
    $('itemTitle').value = item?.title || '';
    $('itemDate').value = item?.date || '';
    $('itemDueDate').value = item?.due_date || '';
    $('itemPriority').value = item?.priority || '보통';
    $('itemStatus').value = item?.status || '진행';
    $('itemNote').value = item?.note || '';
    $('deleteItemBtn').classList.toggle('hidden', !item);
    openModal('itemModal');
  }

  function renderStudentOptions(selectedIds = []) {
    const selected = new Set(selectedIds.map(String));
    $('noticeTargets').innerHTML = state.students
      .filter((student) => student.active)
      .sort((a, b) => Number(a.number) - Number(b.number))
      .map((student) => `<option value="${escapeHtml(student.student_id)}" ${selected.has(String(student.student_id)) ? 'selected' : ''}>${escapeHtml(student.number)}번 ${escapeHtml(student.name)}</option>`)
      .join('');
  }

  function syncTargetVisibility() {
    $('noticeTargetsLabel').classList.toggle('hidden', $('noticeScope').value !== '학생개별');
  }

  function openNoticeEditor(noticeId) {
    const notice = state.notices.find((entry) => String(entry.notice_id) === String(noticeId));
    if (!notice) return;
    $('noticeId').value = notice.notice_id;
    $('noticeScope').value = notice.scope || '학급전체';
    $('noticeType').value = notice.notice_type || '공지';
    $('noticeTitle').value = notice.title || '';
    $('noticeContent').value = notice.content || '';
    $('noticeDate').value = notice.notice_date || '';
    $('noticeDueDate').value = notice.due_date || '';
    $('noticeUrgent').checked = truthy(notice.urgent);
    renderStudentOptions(String(notice.target_student_ids || '').split(',').filter(Boolean));
    syncTargetVisibility();
    openModal('noticeModal');
  }

  async function changeNoticeStatus(noticeId, status) {
    if (status === '게시됨' && !window.confirm('확인한 내용을 학생 알림장에 게시할까요?')) return;
    await api('setNoticeStatus', { noticeId, status });
    showToast(status === '게시됨' ? '학생 알림장에 게시했습니다.' : `공지 상태를 ${status}(으)로 바꿨습니다.`);
    await loadAdminData();
  }

  $('authForm').addEventListener('submit', (event) => {
    event.preventDefault();
    unlock($('tokenInput').value.trim());
  });
  $('logoutBtn').addEventListener('click', lock);
  $('refreshBtn').addEventListener('click', () => loadAdminData().catch(showConnectionError));
  $('classSiteLink').href = CONFIG.classSiteUrl || '#';
  $('legacyImportBtn').addEventListener('click', async () => {
    const items = legacySchedule();
    if (!items.length) return detectLegacySchedule();
    const button = $('legacyImportBtn');
    button.disabled = true;
    button.textContent = '가져오는 중…';
    try {
      const result = await api('importLegacyPlanner', { items });
      localStorage.setItem(LEGACY_DONE_KEY, new Date().toISOString());
      $('legacyBanner').classList.add('hidden');
      showToast(`기존 일정 ${result.count}건을 구글 시트로 옮겼습니다.`);
      await loadAdminData();
    } catch (error) { showToast(error.message); }
    finally {
      button.disabled = false;
      button.textContent = '기존 일정 가져오기';
    }
  });

  document.querySelectorAll('.command-chip').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.claudePrompt !== undefined) {
        const current = $('claudePrompt').value.trim();
        $('claudePrompt').value = `${button.dataset.claudePrompt}${current}`;
        $('claudePrompt').focus();
        return;
      }
      const current = $('rawInput').value.trim();
      $('rawInput').value = `${button.dataset.command}\n${current.replace(/^\/공지사항\s*\[[^\]]+\]\s*/i, '')}`.trimEnd();
      $('rawInput').focus();
    });
  });

  $('claudeSettingsBtn').addEventListener('click', () => {
    $('claudeSettings').classList.toggle('hidden');
    if (!$('claudeSettings').classList.contains('hidden')) $('claudeBridgeUrl').focus();
  });

  $('testClaudeBtn').addEventListener('click', async () => {
    const button = $('testClaudeBtn');
    const message = $('claudeSettingsMessage');
    button.disabled = true;
    button.textContent = '확인 중…';
    message.textContent = '';
    try {
      const result = await bridgeRequest('/api/auth-check');
      message.style.color = '#16845b';
      message.textContent = `Claude 연결 정상 · ${result.model || '기본 모델'}`;
      setClaudeState('Claude 연결됨', 'connected');
    } catch (error) {
      message.style.color = '#c9384d';
      message.textContent = error.message;
      setClaudeState('연결 오류', 'error');
    } finally {
      button.disabled = false;
      button.textContent = '연결 확인';
    }
  });

  $('newClaudeChatBtn').addEventListener('click', resetClaudeChat);

  $('claudeFiles').addEventListener('change', () => {
    const selected = [...$('claudeFiles').files];
    const allowed = /\.(pdf|xlsx|csv|txt|png|jpe?g|webp|gif)$/i;
    const invalid = selected.find((file) => !allowed.test(file.name) || file.size > 6 * 1024 * 1024);
    if (selected.length > 5) return showToast('첨부파일은 최대 5개까지 가능합니다.');
    if (invalid) return showToast(`${invalid.name}: 지원 형식과 6MB 제한을 확인해주세요.`);
    if (selected.reduce((sum, file) => sum + file.size, 0) > 15 * 1024 * 1024) return showToast('첨부파일 전체 크기는 15MB 이하여야 합니다.');
    state.claudeFiles = selected;
    renderClaudeFiles();
  });
  $('claudeFileList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-file]');
    if (!button) return;
    state.claudeFiles.splice(Number(button.dataset.removeFile), 1);
    $('claudeFiles').value = '';
    renderClaudeFiles();
  });

  $('claudeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const prompt = $('claudePrompt').value.trim() || (state.claudeFiles.length ? '첨부파일 내용을 읽고 알림장 항목으로 정리해줘.' : '');
    if (!prompt) return showToast('Claude에게 보낼 내용이나 파일을 추가해주세요.');
    const button = $('claudeSendBtn');
    const history = state.claudeMessages.slice(-8);
    const files = state.claudeFiles.slice();
    state.claudeMessages.push({ role: 'user', content: `${prompt}${files.length ? `\n\n첨부: ${files.map((file) => file.name).join(', ')}` : ''}` });
    $('claudePrompt').value = '';
    button.disabled = true;
    button.textContent = 'Claude가 정리 중…';
    renderClaudeMessages(true);
    try {
      const attachments = await Promise.all(files.map(filePayload));
      const result = await bridgeRequest('/api/claude', { body: { prompt, messages: history, files: attachments } });
      state.claudeMessages.push({ role: 'assistant', content: result.reply || '요청을 처리했습니다.' });
      setClaudeState('Claude 연결됨', 'connected');
      if (result.canApply && result.applyText) {
        state.claudeDraft = result.applyText;
        $('claudeApplyText').value = result.applyText;
        $('claudeDraft').classList.remove('hidden');
        $('claudeApplyResult').classList.add('hidden');
      }
      state.claudeFiles = [];
      $('claudeFiles').value = '';
      renderClaudeFiles();
    } catch (error) {
      state.claudeMessages.push({ role: 'assistant', content: `요청을 처리하지 못했습니다. ${error.message}` });
      setClaudeState('연결 오류', 'error');
      if (/주소|접속키|연결|OAuth|CLAUDE_CODE/.test(error.message)) $('claudeSettings').classList.remove('hidden');
    } finally {
      renderClaudeMessages();
      button.disabled = false;
      button.textContent = 'Claude에게 보내기';
    }
  });

  $('discardClaudeDraftBtn').addEventListener('click', () => {
    state.claudeDraft = '';
    $('claudeApplyText').value = '';
    $('claudeDraft').classList.add('hidden');
  });

  $('applyClaudeDraftBtn').addEventListener('click', async () => {
    const button = $('applyClaudeDraftBtn');
    const resultBox = $('claudeApplyResult');
    resultBox.classList.add('hidden');
    try {
      await ingestText($('claudeApplyText').value.trim(), button, resultBox, 'ingestPrepared');
      state.claudeDraft = '';
      showToast('Claude 정리 내용을 개인 알림장에 반영했습니다.');
    } catch (error) {
      resultBox.className = 'result-message warning';
      resultBox.textContent = error.message;
    }
  });

  $('ingestForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('ingestBtn');
    const rawText = $('rawInput').value.trim();
    if (!rawText) return showToast('정리할 내용을 입력해주세요.');
    const resultBox = $('ingestResult');
    try {
      await ingestText(rawText, button, resultBox);
      $('rawInput').value = '';
    } catch (error) {
      resultBox.className = 'result-message warning';
      resultBox.textContent = error.message;
    }
  });

  $('noticeFilter').addEventListener('click', (event) => {
    const button = event.target.closest('[data-status]');
    if (!button) return;
    state.noticeStatus = button.dataset.status;
    [...$('noticeFilter').children].forEach((child) => child.classList.toggle('active', child === button));
    renderNotices();
  });

  $('categoryFilter').addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    state.category = button.dataset.category;
    [...$('categoryFilter').children].forEach((child) => child.classList.toggle('active', child === button));
    renderPlanner();
  });

  $('noticeList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-notice-action]');
    if (!button) return;
    const { noticeAction, id } = button.dataset;
    try {
      if (noticeAction === 'edit') return openNoticeEditor(id);
      if (noticeAction === 'publish') await changeNoticeStatus(id, '게시됨');
      if (noticeAction === 'hold') await changeNoticeStatus(id, '보류');
      if (noticeAction === 'close') await changeNoticeStatus(id, '종료됨');
      if (noticeAction === 'review') await changeNoticeStatus(id, '검토대기');
    } catch (error) { showToast(error.message); }
  });

  $('plannerList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-item-action]');
    if (!button) return;
    if (button.dataset.itemAction === 'edit') return openItemEditor(button.dataset.id);
    if (button.dataset.itemAction === 'delete') {
      try { await removePlannerItem(button.dataset.id); }
      catch (error) { showToast(error.message); }
    }
  });
  $('plannerList').addEventListener('change', async (event) => {
    const checkbox = event.target.closest('[data-item-action="toggle"]');
    if (!checkbox) return;
    try {
      await api('setPlannerStatus', { itemId: checkbox.dataset.id, status: checkbox.checked ? '완료' : '진행' });
      await loadAdminData();
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      showToast(error.message);
    }
  });

  $('addItemBtn').addEventListener('click', () => openItemEditor());
  $('itemForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const existing = state.plannerItems.find((item) => String(item.item_id) === $('itemId').value) || {};
    const item = {
      ...existing,
      item_id: $('itemId').value,
      category: $('itemCategory').value,
      item_type: $('itemType').value,
      title: $('itemTitle').value.trim(),
      date: $('itemDate').value,
      due_date: $('itemDueDate').value,
      priority: $('itemPriority').value,
      status: $('itemStatus').value,
      note: $('itemNote').value.trim(),
    };
    try {
      await api('upsertPlannerItem', { item });
      closeModal('itemModal');
      showToast('개인 알림장에 저장했습니다.');
      await loadAdminData();
    } catch (error) { showToast(error.message); }
  });
  async function removePlannerItem(itemId) {
    if (!itemId || !window.confirm('이 일정을 삭제할까요?')) return;
    const result = await api('deletePlannerItem', { itemId });
    state.plannerItems = state.plannerItems.filter((item) => String(item.item_id) !== String(itemId));
    renderAll();
    closeModal('itemModal');
    showToast(result.deleted === false ? '이미 삭제된 일정입니다.' : '일정을 삭제했습니다.');
    try { await loadAdminData(); }
    catch (error) { showConnectionError(error); }
  }
  $('deleteItemBtn').addEventListener('click', async () => {
    try { await removePlannerItem($('itemId').value); }
    catch (error) { showToast(error.message); }
  });

  $('noticeScope').addEventListener('change', syncTargetVisibility);
  $('noticeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const existing = state.notices.find((notice) => String(notice.notice_id) === $('noticeId').value) || {};
    const selectedTargets = [...$('noticeTargets').selectedOptions].map((option) => option.value);
    const notice = {
      ...existing,
      notice_id: $('noticeId').value,
      scope: $('noticeScope').value,
      target_student_ids: $('noticeScope').value === '학생개별' ? selectedTargets.join(',') : '',
      notice_type: $('noticeType').value,
      title: $('noticeTitle').value.trim(),
      content: $('noticeContent').value.trim(),
      notice_date: $('noticeDate').value,
      due_date: $('noticeDueDate').value,
      urgent: $('noticeUrgent').checked,
    };
    try {
      await api('updateNotice', { notice });
      closeModal('noticeModal');
      showToast('공지 수정 내용을 저장했습니다.');
      await loadAdminData();
    } catch (error) { showToast(error.message); }
  });

  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal(backdrop.id);
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach((modal) => closeModal(modal.id));
  });

  $('calendarGrid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-calendar-date]');
    if (!button) return;
    state.selectedDate = button.dataset.calendarDate;
    renderCalendar();
  });
  $('prevMonth').addEventListener('click', () => { state.calendarDate.setMonth(state.calendarDate.getMonth() - 1); state.selectedDate = ''; renderCalendar(); });
  $('nextMonth').addEventListener('click', () => { state.calendarDate.setMonth(state.calendarDate.getMonth() + 1); state.selectedDate = ''; renderCalendar(); });
  $('todayMonth').addEventListener('click', () => { state.calendarDate = new Date(); state.selectedDate = today(); renderCalendar(); });

  $('claudeBridgeUrl').value = localStorage.getItem(CLAUDE_URL_KEY) || CONFIG.claudeBridgeUrl || '';
  $('claudeBridgeKey').value = sessionStorage.getItem(CLAUDE_ACCESS_KEY) || '';
  if ($('claudeBridgeUrl').value && $('claudeBridgeKey').value) setClaudeState('연결 확인 필요', 'pending');
  renderClaudeMessages();
  renderCalendar();
  if (state.token) unlock(state.token);
  else setTimeout(() => $('tokenInput').focus(), 30);
})();
