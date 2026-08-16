/**
 * 학급 플래너 v3 - Google Sheets + Apps Script 통합 백엔드
 *
 * 설치 위치: 관리용 Google 스프레드시트 > 확장 프로그램 > Apps Script
 * 공개 저장소에 비밀값을 넣지 않습니다. 관리자 토큰과 OpenAI API 키는
 * Apps Script의 Script Properties에만 저장됩니다.
 */

const APP = Object.freeze({
  sheets: {
    students: '앱_학생목록',
    inbox: '앱_입력함',
    planner: '앱_개인알림장',
    notices: '앱_공지사항',
    responses: '앱_학생응답',
    audit: '앱_변경기록',
  },
  headers: {
    students: ['student_id', 'number', 'name', 'personal_code', 'active', 'note'],
    inbox: ['input_id', 'received_at', 'command', 'raw_text', 'analysis_json', 'status', 'warning'],
    planner: ['item_id', 'input_id', 'category', 'item_type', 'title', 'date', 'due_date', 'note', 'priority', 'status', 'linked_notice_ids', 'created_at', 'updated_at'],
    notices: ['notice_id', 'input_id', 'scope', 'target_student_ids', 'title', 'content', 'notice_date', 'due_date', 'urgent', 'notice_type', 'status', 'published_at', 'ends_at', 'created_at', 'updated_at'],
    responses: ['responded_at', 'student_id', 'item_type', 'item_id', 'response'],
    audit: ['changed_at', 'actor', 'action', 'record_type', 'record_id', 'summary'],
  },
  categories: ['학급', '교과', '개인'],
  noticeStatuses: ['검토대기', '보류', '게시됨', '종료됨'],
  plannerStatuses: ['진행', '완료'],
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('학급 플래너')
    .addItem('1. 앱 시트 만들기/점검', 'setupClassPlanner')
    .addItem('2. 기존 명단 가져오기', 'importLegacyStudentsFromMenu')
    .addItem('3. 관리자 토큰 설정', 'setAdminToken')
    .addItem('4. OpenAI API 키 설정(선택)', 'setOpenAIKey')
    .addItem('연결 상태 확인', 'showSetupStatus')
    .addToUi();
}

/** 기존 탭은 건드리지 않고 앱 전용 탭만 생성한다. */
function setupClassPlanner() {
  const props = PropertiesService.getScriptProperties();
  const createdDefaultToken = !props.getProperty('ADMIN_TOKEN_HASH');
  if (createdDefaultToken) {
    props.setProperty('ADMIN_TOKEN_HASH', sha256_('admin1234'));
  }
  ensureClassPlannerSheets_();
  SpreadsheetApp.getUi().alert(
    '앱 전용 시트를 준비했습니다.\n\n' +
    (createdDefaultToken
      ? '관리자 초기 비밀번호는 admin1234입니다. 필요하면 “관리자 토큰 설정”에서 변경하세요.\n\n'
      : '기존 관리자 비밀번호는 그대로 유지했습니다.\n\n') +
    '학생 명단을 앱_학생목록에 입력하세요.'
  );
}

function importLegacyStudentsFromMenu() {
  try {
    ensureClassPlannerSheets_();
    const result = importLegacyStudents_();
    SpreadsheetApp.getUi().alert(
      result.found
        ? '기존 명단에서 ' + result.count + '명을 가져왔습니다.\n' +
          '개인 코드 설정: ' + result.withCode + '명\n' +
          (result.duplicateCodes ? '중복 코드: ' + result.duplicateCodes + '개(확인 필요)' : '중복 코드 없음')
        : '“명단” 시트를 찾지 못했습니다. 앱_학생목록에 학생 정보를 직접 입력해주세요.'
    );
  } catch (error) {
    SpreadsheetApp.getUi().alert(publicError_(error));
  }
}

function setAdminToken() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    '관리자 토큰 설정',
    '개인 알림장과 학급 알림장 관리자 페이지에 로그인할 비밀번호를 입력하세요. 8자 이상이어야 합니다.',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  const token = result.getResponseText().trim();
  if (token.length < 8) {
    ui.alert('비밀번호가 너무 짧습니다. 8자 이상으로 설정해주세요.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('ADMIN_TOKEN_HASH', sha256_(token));
  ui.alert('관리자 토큰을 저장했습니다. 토큰 원문은 저장되지 않으니 따로 보관하세요.');
}

function setOpenAIKey() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    'OpenAI API 키 설정(선택)',
    'API 키를 입력하세요. 비워서 확인하면 기존 키를 삭제합니다.',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  const key = result.getResponseText().trim();
  const props = PropertiesService.getScriptProperties();
  if (key) props.setProperty('OPENAI_API_KEY', key);
  else props.deleteProperty('OPENAI_API_KEY');
  ui.alert(key ? 'API 키를 Script Properties에 저장했습니다.' : '기존 API 키를 삭제했습니다.');
}

function showSetupStatus() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const missing = Object.keys(APP.sheets).filter(function (key) {
    return !ss.getSheetByName(APP.sheets[key]);
  });
  SpreadsheetApp.getUi().alert(
    '시트: ' + (missing.length ? '누락 - ' + missing.join(', ') : '정상') + '\n' +
    '관리자 토큰: ' + (props.getProperty('ADMIN_TOKEN_HASH') ? '설정됨' : '미설정') + '\n' +
    'AI 정리: ' + (props.getProperty('OPENAI_API_KEY') ? '사용 가능' : '미설정 - 기본 정리 사용')
  );
}

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'student');
    if (action === 'health') {
      return json_({ ok: true, version: 3, service: 'class-planner' });
    }
    return json_(getStudentFeed_(String((e && e.parameter && e.parameter.code) || '')));
  } catch (error) {
    return json_({ ok: false, error: publicError_(error) });
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = String(body.action || '');

    if (action === 'recordResponse') {
      return json_(recordStudentResponse_(body));
    }

    requireAdmin_(body.token);
    ensureClassPlannerSheets_();
    switch (action) {
      case 'adminLoad': return json_(getAdminData_());
      case 'validateStudentSetup': return json_(validateStudentSetup_());
      case 'ingest': return json_(ingest_(body.rawText));
      case 'ingestPrepared': return json_(ingest_(body.rawText, true));
      case 'importLegacyPlanner': return json_(importLegacyPlanner_(body.items || []));
      case 'importLegacyStudents': return json_(importLegacyStudents_());
      case 'upsertPlannerItem': return json_(upsertPlannerItem_(body.item || {}));
      case 'setPlannerStatus': return json_(setPlannerStatus_(body.itemId, body.status));
      case 'deletePlannerItem': return json_(deletePlannerItem_(body.itemId));
      case 'createNotice': return json_(createNotice_(body.notice || {}));
      case 'updateNotice': return json_(updateNotice_(body.notice || {}));
      case 'setNoticeStatus': return json_(setNoticeStatus_(body.noticeId, body.status));
      default: throw new Error('지원하지 않는 요청입니다.');
    }
  } catch (error) {
    return json_({ ok: false, error: publicError_(error) });
  }
}

function getAdminData_() {
  const result = {
    ok: true,
    version: 3,
    plannerItems: readObjects_('planner'),
    notices: readObjects_('notices'),
    students: readObjects_('students').map(function (student) {
      return {
        student_id: studentId_(student),
        number: student.number,
        name: student.name,
        active: isStudentActive_(student),
        has_code: !!String(student.personal_code || '').trim(),
        note: student.note || '',
      };
    }),
    updatedAt: isoNow_(),
    aiEnabled: !!PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY'),
  };
  return result;
}

function validateStudentSetup_() {
  const students = readObjects_('students').filter(isStudentActive_);
  const codeCounts = {};
  let withCode = 0;
  students.forEach(function (student) {
    const code = normalizeStudentCode_(student.personal_code);
    if (!code) return;
    withCode += 1;
    codeCounts[code] = (codeCounts[code] || 0) + 1;
  });
  const duplicateCodes = Object.keys(codeCounts).filter(function (code) { return codeCounts[code] > 1; }).length;
  const authReady = students.length > 0 && withCode === students.length && duplicateCodes === 0;
  let loginProbe = false;
  if (authReady) {
    const sample = students[0];
    const feed = getStudentFeed_(sample.personal_code);
    loginProbe = !!feed.student && Number(feed.student.num) === Number(sample.number);
  }
  return {
    ok: true,
    activeStudents: students.length,
    studentsWithCode: withCode,
    duplicateCodes: duplicateCodes,
    authReady: authReady,
    loginProbe: loginProbe,
  };
}

function ingest_(rawText, usePreparedText) {
  rawText = String(rawText || '').trim();
  if (!rawText) throw new Error('정리할 내용을 입력해주세요.');
  const blocks = splitCommandBlocks_(rawText);
  const results = blocks.map(function (block) { return ingestSingle_(block, usePreparedText); });
  if (results.length === 1) return results[0];

  const combined = { ok: true, inputIds: [], plannerItems: [], notices: [], warning: '' };
  results.forEach(function (result) {
    combined.inputIds.push(result.inputId);
    combined.plannerItems = combined.plannerItems.concat(result.plannerItems || []);
    combined.notices = combined.notices.concat(result.notices || []);
    if (result.warning) combined.warning = [combined.warning, result.warning].filter(Boolean).join(' / ');
  });
  combined.inputId = combined.inputIds[0] || '';
  return combined;
}

function ingestSingle_(rawText, usePreparedText) {
  rawText = String(rawText || '').trim();
  if (!rawText) throw new Error('정리할 내용을 입력해주세요.');

  const command = parseCommand_(rawText);
  const inputId = id_('I');
  let analysis;
  let warning = '';
  try {
    analysis = usePreparedText ? fallbackAnalysis_(command) : analyzeWithOpenAI_(command);
  } catch (error) {
    analysis = fallbackAnalysis_(command);
    warning = 'AI 정리를 사용하지 못해 기본 규칙으로 등록했습니다: ' + publicError_(error);
  }
  analysis = enforceCommand_(analysis, command);
  if (Array.isArray(analysis.warnings) && analysis.warnings.length) {
    warning = [warning, analysis.warnings.join(' / ')].filter(Boolean).join(' / ');
  }

  const plannerRows = [];
  const noticeRows = [];
  const createdAt = isoNow_();
  const students = readObjects_('students');

  (analysis.plannerItems || []).forEach(function (item) {
    const row = {
      item_id: id_('P'),
      input_id: inputId,
      category: item.category,
      item_type: item.itemType || '업무',
      title: item.title,
      date: item.date || '',
      due_date: item.dueDate || '',
      note: item.note || '',
      priority: item.priority || '보통',
      status: '진행',
      linked_notice_ids: '',
      created_at: createdAt,
      updated_at: createdAt,
    };
    plannerRows.push(row);
  });

  (analysis.notices || []).forEach(function (notice) {
    const resolved = resolveTargets_(notice.targetNames || [], students);
    const noticeId = id_('N');
    const noticeWarning = resolved.missing.length
      ? '학생 이름 확인 필요: ' + resolved.missing.join(', ')
      : '';
    if (noticeWarning) warning = [warning, noticeWarning].filter(Boolean).join(' / ');
    noticeRows.push({
      notice_id: noticeId,
      input_id: inputId,
      scope: notice.scope || '학급전체',
      target_student_ids: resolved.ids.join(','),
      title: notice.title,
      content: notice.content || '',
      notice_date: notice.noticeDate || today_(),
      due_date: notice.dueDate || '',
      urgent: notice.urgent ? 'TRUE' : 'FALSE',
      notice_type: notice.noticeType || '공지',
      status: '검토대기',
      published_at: '',
      ends_at: notice.endsAt || notice.dueDate || '',
      created_at: createdAt,
      updated_at: createdAt,
    });
    plannerRows.forEach(function (planner) {
      if (planner.category === '학급') {
        planner.linked_notice_ids = [planner.linked_notice_ids, noticeId].filter(Boolean).join(',');
      }
    });
  });

  appendObjects_('inbox', [{
    input_id: inputId,
    received_at: createdAt,
    command: command.label,
    raw_text: rawText,
    analysis_json: JSON.stringify(analysis),
    status: '분석완료',
    warning: warning,
  }]);
  appendObjects_('planner', plannerRows);
  appendObjects_('notices', noticeRows);
  audit_('입력정리', '입력', inputId, command.label + ' / 일정 ' + plannerRows.length + '건 / 공지 ' + noticeRows.length + '건');

  return {
    ok: true,
    inputId: inputId,
    plannerItems: plannerRows,
    notices: noticeRows,
    warning: warning,
  };
}

function splitCommandBlocks_(rawText) {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let current = [];
  lines.forEach(function (line) {
    const startsCommand = /^\s*\/공지사항\s*\[[^\]]+\]/i.test(line);
    if (startsCommand && current.some(function (value) { return String(value).trim(); })) {
      blocks.push(current.join('\n').replace(/\n?\s*---\s*$/, '').trim());
      current = [];
    }
    if (/^\s*---\s*$/.test(line)) {
      if (current.some(function (value) { return String(value).trim(); })) {
        blocks.push(current.join('\n').trim());
        current = [];
      }
      return;
    }
    current.push(line);
  });
  if (current.some(function (value) { return String(value).trim(); })) blocks.push(current.join('\n').trim());
  return blocks.filter(Boolean);
}

function parseCommand_(rawText) {
  const match = rawText.match(/^\s*\/공지사항\s*\[([^\]]+)\]\s*([\s\S]*)$/i);
  if (!match) {
    throw new Error('첫 줄을 /공지사항 [개인], [교과], [학급], [학생개별: 이름] 중 하나로 시작해주세요.');
  }
  const label = match[1].trim();
  const content = match[2].trim();
  if (!content) throw new Error('명령어 뒤에 정리할 내용을 입력해주세요.');

  if (label === '개인') return { label: label, category: '개인', noticeScope: '', targetNames: [], content: content };
  if (label === '교과') return { label: label, category: '교과', noticeScope: '', targetNames: [], content: content };
  if (label === '학급') return { label: label, category: '학급', noticeScope: '학급전체', targetNames: [], content: content };

  const personal = label.match(/^학생개별\s*:\s*(.+)$/);
  if (personal) {
    const names = personal[1].split(/[,，]/).map(function (name) { return name.trim(); }).filter(Boolean);
    if (!names.length) throw new Error('학생개별 명령에는 학생 이름을 적어주세요.');
    return { label: label, category: '학급', noticeScope: '학생개별', targetNames: names, content: content };
  }
  throw new Error('알 수 없는 분류입니다: ' + label);
}

function analyzeWithOpenAI_(command) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('OPENAI_API_KEY');
  if (!apiKey) return fallbackAnalysis_(command);

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      plannerItems: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            category: { type: 'string', enum: ['학급', '교과', '개인'] },
            itemType: { type: 'string', enum: ['업무', '일정'] },
            title: { type: 'string' },
            date: { type: 'string' },
            dueDate: { type: 'string' },
            note: { type: 'string' },
            priority: { type: 'string', enum: ['높음', '보통', '낮음'] },
          },
          required: ['category', 'itemType', 'title', 'date', 'dueDate', 'note', 'priority'],
        },
      },
      notices: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scope: { type: 'string', enum: ['학급전체', '학생개별'] },
            targetNames: { type: 'array', items: { type: 'string' } },
            title: { type: 'string' },
            content: { type: 'string' },
            noticeDate: { type: 'string' },
            dueDate: { type: 'string' },
            endsAt: { type: 'string' },
            urgent: { type: 'boolean' },
            noticeType: { type: 'string', enum: ['공지', '할일'] },
          },
          required: ['scope', 'targetNames', 'title', 'content', 'noticeDate', 'dueDate', 'endsAt', 'urgent', 'noticeType'],
        },
      },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['plannerItems', 'notices', 'warnings'],
  };

  const system = [
    '당신은 한국 고등학교 교사의 전달사항을 일정과 학생 안내로 정리한다.',
    '오늘 날짜는 ' + today_() + '이다.',
    '교사의 업무 마감일과 학생의 제출일을 구분한다.',
    '연도 없는 날짜는 오늘을 기준으로 가장 자연스러운 미래 날짜를 YYYY-MM-DD로 쓴다.',
    '날짜를 알 수 없으면 빈 문자열로 두고 warnings에 이유를 적는다.',
    '학생용 content는 짧고 정중한 한국어로 쓰며 다른 학생의 이름을 넣지 않는다.',
    '원문 하나에 여러 일정이나 공지가 있으면 항목을 나눈다.',
  ].join('\n');

  const payload = {
    model: props.getProperty('OPENAI_MODEL') || 'gpt-5.4-mini',
    input: [
      { role: 'system', content: [{ type: 'input_text', text: system }] },
      { role: 'user', content: [{ type: 'input_text', text: command.content }] },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'class_planner_ingest',
        strict: true,
        schema: schema,
      },
    },
  };

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/responses', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  const json = JSON.parse(response.getContentText() || '{}');
  if (code < 200 || code >= 300) {
    throw new Error((json.error && json.error.message) || ('OpenAI API 오류 ' + code));
  }
  const text = extractOutputText_(json);
  if (!text) throw new Error('AI 응답에서 정리 결과를 찾지 못했습니다.');
  return JSON.parse(text);
}

function fallbackAnalysis_(command) {
  const lines = command.content.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  const title = String(lines[0] || command.content).replace(/^[-•]\s*/, '').slice(0, 70);
  const date = extractDate_(command.content);
  const checklist = extractChecklistEntries_(command.content);
  const splitEntries = checklist.length >= 2 ? checklist : [];
  const entries = splitEntries.length ? splitEntries : [title];
  const context = splitEntries.length
    ? lines.filter(function (line) { return !checklistEntry_(line); }).join('\n')
    : command.content;
  const plannerItems = entries.map(function (entry) {
    const entryDate = extractDate_(entry) || date;
    const looksLikeTask = splitEntries.length > 0 || taskLike_(entry);
    return {
      category: command.category,
      itemType: looksLikeTask ? '업무' : '일정',
      title: String(entry).slice(0, 70),
      date: looksLikeTask ? '' : entryDate,
      dueDate: looksLikeTask ? entryDate : '',
      note: splitEntries.length ? [context, entry].filter(Boolean).join('\n') : command.content,
      priority: /(긴급|중요|필수)/.test(command.content) ? '높음' : '보통',
    };
  });
  const notices = command.noticeScope ? entries.map(function (entry) {
    const entryDate = extractDate_(entry) || date;
    return {
      scope: command.noticeScope,
      targetNames: command.targetNames,
      title: String(entry).slice(0, 70),
      content: splitEntries.length ? [context, entry].filter(Boolean).join('\n') : command.content,
      noticeDate: today_(),
      dueDate: entryDate,
      endsAt: entryDate,
      urgent: /(긴급|중요|필수)/.test(command.content),
      noticeType: taskLike_(entry) ? '할일' : '공지',
    };
  }) : [];
  return {
    plannerItems: plannerItems,
    notices: notices,
    warnings: date ? [] : ['날짜를 자동으로 확정하지 못했습니다.'],
  };
}

function checklistEntry_(line) {
  const match = String(line || '').match(/^\s*(?:\d{1,2}[.)]|[-•])\s*(.+)$/);
  return match ? match[1].trim() : '';
}

function extractChecklistEntries_(text) {
  return String(text || '').split(/\r?\n/).map(checklistEntry_).filter(Boolean);
}

function taskLike_(text) {
  return /(제출|신청|준비(?:물|해|하|하기)|가져오|지참|작성|과제|숙제|마감)/.test(String(text || ''));
}

/** 명령어가 최종 공개 범위를 결정하며 AI가 이를 바꿀 수 없다. */
function enforceCommand_(analysis, command) {
  analysis = analysis || {};
  let items = Array.isArray(analysis.plannerItems) ? analysis.plannerItems : [];
  let notices = Array.isArray(analysis.notices) ? analysis.notices : [];
  if (!items.length) items = fallbackAnalysis_(command).plannerItems;
  items = items.map(function (item) {
    item.category = command.category;
    item.title = String(item.title || command.content).trim().slice(0, 120);
    item.note = String(item.note || '').trim();
    item.date = normalizeDate_(item.date);
    item.dueDate = normalizeDate_(item.dueDate);
    return item;
  });
  if (!command.noticeScope) notices = [];
  else if (!notices.length) notices = fallbackAnalysis_(command).notices;
  notices = notices.map(function (notice) {
    notice.scope = command.noticeScope;
    notice.targetNames = command.noticeScope === '학생개별' ? command.targetNames.slice() : [];
    notice.title = String(notice.title || command.content).trim().slice(0, 120);
    notice.content = String(notice.content || command.content).trim();
    notice.noticeDate = normalizeDate_(notice.noticeDate) || today_();
    notice.dueDate = normalizeDate_(notice.dueDate);
    notice.endsAt = normalizeDate_(notice.endsAt);
    return notice;
  });
  return { plannerItems: items, notices: notices, warnings: analysis.warnings || [] };
}

function getStudentFeed_(code) {
  const students = readObjects_('students');
  const normalized = normalizeStudentCode_(code);
  const matches = normalized ? students.filter(function (row) {
    return isStudentActive_(row) && normalizeStudentCode_(row.personal_code) === normalized;
  }) : [];
  const student = matches.length === 1 ? matches[0] : null;

  const notices = readObjects_('notices').filter(function (notice) {
    if (String(notice.status) !== '게시됨') return false;
    if (notice.scope === '학급전체') return true;
    if (!student) return false;
    return splitIds_(notice.target_student_ids).indexOf(studentId_(student)) >= 0;
  });

  const publicNotices = [];
  const tasks = [];
  notices.forEach(function (notice) {
    const audience = notice.scope === '학급전체' ? 'all' : Number(student.number);
    const base = {
      id: String(notice.notice_id),
      title: String(notice.title || ''),
      audience: audience,
    };
    if (notice.notice_type === '할일') {
      tasks.push(Object.assign({}, base, { dueDate: String(notice.due_date || notice.notice_date || '') }));
    } else {
      publicNotices.push(Object.assign({}, base, {
        content: String(notice.content || ''),
        date: String(notice.notice_date || today_()),
        urgent: isTrue_(notice.urgent),
      }));
    }
  });

  return {
    ok: true,
    version: 3,
    student: student ? { num: Number(student.number), name: String(student.number) + '번' } : null,
    notices: publicNotices,
    tasks: tasks,
  };
}

function recordStudentResponse_(body) {
  const code = normalizeStudentCode_(body.code);
  const matches = readObjects_('students').filter(function (row) {
    return isStudentActive_(row) && normalizeStudentCode_(row.personal_code) === code;
  });
  const student = code && matches.length === 1 ? matches[0] : null;
  if (!student) throw new Error('학생 코드를 확인할 수 없습니다.');
  const notice = findObject_('notices', 'notice_id', body.itemId);
  const allowed = notice && String(notice.status) === '게시됨' && (
    notice.scope === '학급전체' || splitIds_(notice.target_student_ids).indexOf(studentId_(student)) >= 0
  );
  if (!allowed) throw new Error('응답할 수 있는 공지를 찾을 수 없습니다.');
  appendObjects_('responses', [{
    responded_at: isoNow_(),
    student_id: studentId_(student),
    item_type: String(body.itemType || ''),
    item_id: String(body.itemId || ''),
    response: String(body.response || ''),
  }]);
  return { ok: true };
}

function upsertPlannerItem_(item) {
  const now = isoNow_();
  const clean = {
    item_id: String(item.item_id || id_('P')),
    input_id: String(item.input_id || ''),
    category: APP.categories.indexOf(item.category) >= 0 ? item.category : '개인',
    item_type: item.item_type === '일정' ? '일정' : '업무',
    title: String(item.title || '').trim(),
    date: normalizeDate_(item.date),
    due_date: normalizeDate_(item.due_date),
    note: String(item.note || '').trim(),
    priority: ['높음', '보통', '낮음'].indexOf(item.priority) >= 0 ? item.priority : '보통',
    status: APP.plannerStatuses.indexOf(item.status) >= 0 ? item.status : '진행',
    linked_notice_ids: String(item.linked_notice_ids || ''),
    created_at: String(item.created_at || now),
    updated_at: now,
  };
  if (!clean.title) throw new Error('일정 제목을 입력해주세요.');
  upsertObject_('planner', 'item_id', clean);
  audit_('저장', '개인알림장', clean.item_id, clean.title);
  return { ok: true, item: clean };
}

function importLegacyPlanner_(items) {
  if (!Array.isArray(items)) throw new Error('기존 일정 형식을 읽을 수 없습니다.');
  if (items.length > 500) throw new Error('한 번에 가져올 수 있는 일정은 500건입니다.');
  const now = isoNow_();
  const rows = items.filter(function (item) { return item && String(item.title || '').trim(); }).map(function (item, index) {
    const legacyId = String(item.id || index).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
    return {
      item_id: 'LEGACY-' + (legacyId || index),
      input_id: '',
      category: item.cat === '개인' ? '개인' : '학급',
      item_type: '일정',
      title: String(item.title).trim().slice(0, 120),
      date: normalizeDate_(item.date),
      due_date: '',
      note: String(item.note || '').trim(),
      priority: '보통',
      status: '진행',
      linked_notice_ids: '',
      created_at: now,
      updated_at: now,
    };
  });
  rows.forEach(function (row) { upsertObject_('planner', 'item_id', row); });
  audit_('기존일정가져오기', '개인알림장', '', rows.length + '건');
  return { ok: true, count: rows.length };
}

function importLegacyStudents_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const legacy = ss.getSheetByName('명단');
  if (!legacy || legacy.getLastRow() < 2) {
    return { ok: true, found: !!legacy, count: 0, withCode: 0, duplicateCodes: 0 };
  }

  const values = legacy.getDataRange().getDisplayValues();
  const headers = values[0].map(function (value) { return String(value || '').trim(); });
  const numberIndex = headers.indexOf('번호');
  const nameIndex = headers.indexOf('이름');
  const codeIndex = headers.indexOf('코드');
  if (numberIndex < 0 || nameIndex < 0 || codeIndex < 0) {
    throw new Error('“명단” 시트의 첫 행에 번호, 이름, 코드 열이 필요합니다.');
  }

  const candidates = values.slice(1).map(function (row) {
    const number = String(row[numberIndex] || '').trim();
    const name = String(row[nameIndex] || '').trim();
    return {
      student_id: studentId_({ number: number }),
      number: number,
      name: name,
      personal_code: normalizeStudentCode_(row[codeIndex]),
    };
  }).filter(function (student) {
    return student.student_id && student.number && student.name;
  });

  const codeCounts = {};
  candidates.forEach(function (student) {
    if (student.personal_code) {
      codeCounts[student.personal_code] = (codeCounts[student.personal_code] || 0) + 1;
    }
  });

  let duplicateCodes = 0;
  Object.keys(codeCounts).forEach(function (code) {
    if (codeCounts[code] > 1) duplicateCodes += 1;
  });

  candidates.forEach(function (student) {
    upsertObject_('students', 'student_id', {
      student_id: student.student_id,
      number: student.number,
      name: student.name,
      personal_code: student.personal_code,
      active: 'TRUE',
      note: '기존 명단에서 가져옴',
    });
  });

  const withCode = candidates.filter(function (student) { return !!student.personal_code; }).length;
  audit_('기존명단가져오기', '학생목록', '', candidates.length + '명 / 코드 ' + withCode + '명 / 중복 ' + duplicateCodes + '개');
  return {
    ok: true,
    found: true,
    count: candidates.length,
    withCode: withCode,
    duplicateCodes: duplicateCodes,
  };
}

function setPlannerStatus_(itemId, status) {
  if (APP.plannerStatuses.indexOf(status) < 0) throw new Error('올바르지 않은 완료 상태입니다.');
  const item = findObject_('planner', 'item_id', itemId);
  if (!item) throw new Error('일정을 찾을 수 없습니다.');
  item.status = status;
  item.updated_at = isoNow_();
  upsertObject_('planner', 'item_id', item);
  audit_('상태변경', '개인알림장', itemId, status);
  return { ok: true };
}

function deletePlannerItem_(itemId) {
  deleteObject_('planner', 'item_id', itemId);
  audit_('삭제', '개인알림장', itemId, '');
  return { ok: true };
}

function createNotice_(notice) {
  const now = isoNow_();
  const row = {
    notice_id: id_('N'),
    input_id: '',
    scope: notice.scope === '학생개별' ? '학생개별' : '학급전체',
    target_student_ids: notice.scope === '학생개별' ? String(notice.target_student_ids || '') : '',
    title: String(notice.title || '').trim(),
    content: String(notice.content || '').trim(),
    notice_date: normalizeDate_(notice.notice_date) || today_(),
    due_date: normalizeDate_(notice.due_date),
    urgent: isTrue_(notice.urgent) ? 'TRUE' : 'FALSE',
    notice_type: notice.notice_type === '할일' ? '할일' : '공지',
    status: '검토대기',
    published_at: '',
    ends_at: normalizeDate_(notice.ends_at),
    created_at: now,
    updated_at: now,
  };
  if (!row.title) throw new Error('공지 제목을 입력해주세요.');
  upsertObject_('notices', 'notice_id', row);
  audit_('직접등록', '공지사항', row.notice_id, row.title);
  return { ok: true, notice: row };
}

function updateNotice_(notice) {
  const current = findObject_('notices', 'notice_id', notice.notice_id);
  if (!current) throw new Error('공지를 찾을 수 없습니다.');
  const merged = Object.assign({}, current, {
    scope: notice.scope === '학생개별' ? '학생개별' : '학급전체',
    target_student_ids: notice.scope === '학생개별' ? String(notice.target_student_ids || '') : '',
    title: String(notice.title || '').trim(),
    content: String(notice.content || '').trim(),
    notice_date: normalizeDate_(notice.notice_date) || today_(),
    due_date: normalizeDate_(notice.due_date),
    urgent: isTrue_(notice.urgent) ? 'TRUE' : 'FALSE',
    notice_type: notice.notice_type === '할일' ? '할일' : '공지',
    ends_at: normalizeDate_(notice.ends_at),
    updated_at: isoNow_(),
  });
  if (!merged.title) throw new Error('공지 제목을 입력해주세요.');
  upsertObject_('notices', 'notice_id', merged);
  audit_('수정', '공지사항', merged.notice_id, merged.title);
  return { ok: true, notice: merged };
}

function setNoticeStatus_(noticeId, status) {
  if (APP.noticeStatuses.indexOf(status) < 0) throw new Error('올바르지 않은 공지 상태입니다.');
  const notice = findObject_('notices', 'notice_id', noticeId);
  if (!notice) throw new Error('공지를 찾을 수 없습니다.');
  if (status === '게시됨' && notice.scope === '학생개별' && !splitIds_(notice.target_student_ids).length) {
    throw new Error('개별 공지의 대상 학생을 먼저 지정해주세요.');
  }
  notice.status = status;
  notice.published_at = status === '게시됨' ? isoNow_() : notice.published_at;
  notice.updated_at = isoNow_();
  upsertObject_('notices', 'notice_id', notice);
  audit_('상태변경', '공지사항', noticeId, status);
  return { ok: true };
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const hasHeader = current.some(function (value) { return String(value).trim(); });
  if (hasHeader && current.join('|') !== headers.join('|')) {
    throw new Error(name + ' 시트의 첫 행 구조가 예상과 다릅니다. 기존 값을 확인해주세요.');
  }
  if (!hasHeader) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1f2937')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.autoResizeColumns(1, headers.length);
}

function ensureClassPlannerSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(APP.sheets).forEach(function (key) {
    ensureSheet_(ss, APP.sheets[key], APP.headers[key]);
  });
  applyValidations_(ss);
}

function applyValidations_(ss) {
  const planner = ss.getSheetByName(APP.sheets.planner);
  const notices = ss.getSheetByName(APP.sheets.notices);
  if (planner) {
    planner.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(APP.categories, true).build());
    planner.getRange('J2:J').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(APP.plannerStatuses, true).build());
  }
  if (notices) {
    notices.getRange('K2:K').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(APP.noticeStatuses, true).build());
  }
}

function readObjects_(key) {
  const sheet = getSheet_(key);
  const headers = APP.headers[key];
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getDisplayValues();
  return values.filter(function (row) {
    return row.some(function (value) { return String(value).trim(); });
  }).map(function (row) {
    const object = {};
    headers.forEach(function (header, index) { object[header] = row[index]; });
    return object;
  });
}

function appendObjects_(key, objects) {
  if (!objects || !objects.length) return;
  const sheet = getSheet_(key);
  const headers = APP.headers[key];
  const rows = objects.map(function (object) {
    return headers.map(function (header) { return object[header] === undefined ? '' : object[header]; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function findObject_(key, idField, id) {
  return readObjects_(key).find(function (object) { return String(object[idField]) === String(id); }) || null;
}

function upsertObject_(key, idField, object) {
  const sheet = getSheet_(key);
  const headers = APP.headers[key];
  const idIndex = headers.indexOf(idField);
  if (idIndex < 0) throw new Error('ID 열을 찾을 수 없습니다.');
  let rowNumber = -1;
  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (let i = 0; i < ids.length; i += 1) {
      if (String(ids[i][0]) === String(object[idField])) { rowNumber = i + 2; break; }
    }
  }
  const row = headers.map(function (header) { return object[header] === undefined ? '' : object[header]; });
  if (rowNumber < 0) rowNumber = sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}

function deleteObject_(key, idField, id) {
  const sheet = getSheet_(key);
  const headers = APP.headers[key];
  const idIndex = headers.indexOf(idField);
  if (sheet.getLastRow() < 2) return;
  const ids = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    if (String(ids[i][0]) === String(id)) sheet.deleteRow(i + 2);
  }
}

function getSheet_(key) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(APP.sheets[key]);
  if (!sheet) throw new Error(APP.sheets[key] + ' 시트가 없습니다. setupClassPlanner를 먼저 실행해주세요.');
  return sheet;
}

function resolveTargets_(names, students) {
  const ids = [];
  const missing = [];
  names.forEach(function (name) {
    const clean = String(name).replace(/\s+/g, '');
    const found = students.find(function (student) {
      return String(student.name || '').replace(/\s+/g, '') === clean && isStudentActive_(student);
    });
    if (found) ids.push(studentId_(found));
    else missing.push(name);
  });
  return { ids: ids, missing: missing };
}

function audit_(action, recordType, recordId, summary) {
  appendObjects_('audit', [{
    changed_at: isoNow_(), actor: '관리자', action: action,
    record_type: recordType, record_id: recordId, summary: summary,
  }]);
}

function requireAdmin_(token) {
  const props = PropertiesService.getScriptProperties();
  let expected = props.getProperty('ADMIN_TOKEN_HASH');
  if (!expected) {
    if (String(token || '') !== 'admin1234') {
      throw new Error('관리자 토큰이 아직 설정되지 않았습니다.');
    }
    expected = sha256_('admin1234');
    props.setProperty('ADMIN_TOKEN_HASH', expected);
  }
  if (!token || sha256_(String(token)) !== expected) throw new Error('관리자 인증에 실패했습니다.');
}

function parseBody_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  try { return JSON.parse(raw); }
  catch (error) { throw new Error('요청 형식을 읽을 수 없습니다.'); }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function sha256_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map(function (byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function normalizeStudentCode_(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits && digits.length < 6) digits = ('000000' + digits).slice(-6);
  return digits;
}

function splitIds_(value) {
  return String(value || '').split(',').map(function (id) { return id.trim(); }).filter(Boolean);
}

function extractOutputText_(response) {
  const output = response && response.output;
  if (!Array.isArray(output)) return '';
  for (let i = 0; i < output.length; i += 1) {
    const content = output[i] && output[i].content;
    if (!Array.isArray(content)) continue;
    for (let j = 0; j < content.length; j += 1) {
      if (content[j] && content[j].type === 'output_text') return String(content[j].text || '');
    }
  }
  return '';
}

function extractDate_(text) {
  const relative = String(text).match(/(오늘|내일|모레)/);
  if (relative) {
    const add = relative[1] === '오늘' ? 0 : relative[1] === '내일' ? 1 : 2;
    const date = new Date();
    date.setDate(date.getDate() + add);
    return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd');
  }
  const iso = String(text).match(/(20\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})/);
  if (iso) return [iso[1], pad2_(iso[2]), pad2_(iso[3])].join('-');
  const md = String(text).match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) {
    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(year, Number(md[1]) - 1, Number(md[2]));
    if (candidate.getTime() < now.getTime() - 86400000 * 30) year += 1;
    return [year, pad2_(md[1]), pad2_(md[2])].join('-');
  }
  return '';
}

function normalizeDate_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  return match ? text : extractDate_(text);
}

function isTrue_(value) {
  return value === true || /^(true|1|yes|y|사용|활성)$/i.test(String(value || '').trim());
}

function isStudentActive_(student) {
  const value = String(student && student.active !== undefined ? student.active : '').trim();
  return value === '' || isTrue_(value);
}

function studentId_(student) {
  const explicit = String(student && student.student_id || '').trim();
  if (explicit) return explicit;
  const number = String(student && student.number || '').replace(/\D/g, '');
  return number ? 'S' + ('000' + number).slice(-3) : '';
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd');
}

function isoNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function id_(prefix) {
  return prefix + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMddHHmmssSSS') + Math.floor(Math.random() * 1000);
}

function pad2_(value) { return ('0' + Number(value)).slice(-2); }

function publicError_(error) {
  const message = error && error.message ? error.message : String(error || '알 수 없는 오류');
  return message.replace(/sk-[A-Za-z0-9_-]+/g, '[API KEY]');
}
