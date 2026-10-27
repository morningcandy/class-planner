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
    calls: '앱_호출',
    lates: '앱_지각기록',
    duties: '앱_분리수거',
  },
  headers: {
    students: ['student_id', 'number', 'name', 'personal_code', 'active', 'note'],
    inbox: ['input_id', 'received_at', 'command', 'raw_text', 'analysis_json', 'status', 'warning'],
    planner: ['item_id', 'input_id', 'category', 'item_type', 'title', 'date', 'due_date', 'note', 'priority', 'status', 'linked_notice_ids', 'created_at', 'updated_at'],
    notices: ['notice_id', 'input_id', 'scope', 'target_student_ids', 'title', 'content', 'notice_date', 'due_date', 'urgent', 'notice_type', 'status', 'published_at', 'ends_at', 'created_at', 'updated_at', 'sort_order', 'starts_at'],
    responses: ['responded_at', 'student_id', 'item_type', 'item_id', 'response'],
    audit: ['changed_at', 'actor', 'action', 'record_type', 'record_id', 'summary'],
    calls: ['call_id', 'student_id', 'number', 'caller', 'reason', 'status', 'created_at', 'acked_at', 'acked_by'],
    lates: ['late_id', 'date', 'number', 'student_id', 'status', 'duty_id', 'created_at', 'updated_at'],
    duties: ['duty_id', 'duty_date', 'number', 'student_id', 'late_ids', 'status', 'carried_from', 'notice_id', 'created_at', 'done_at'],
  },
  categories: ['학급', '교과', '개인'],
  noticeStatuses: ['검토대기', '보류', '게시됨', '종료됨'],
  plannerStatuses: ['진행', '완료'],
  callStatuses: ['호출중', '전달완료', '취소'],
  lateStatuses: ['유효', '취소'],
  dutyStatuses: ['배정', '완료', '미완료'],
  recyclePerWeek: 2,
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('학급 플래너')
    .addItem('1. 앱 시트 만들기/점검', 'setupClassPlanner')
    .addItem('2. 기존 명단 가져오기', 'importLegacyStudentsFromMenu')
    .addItem('3. 관리자 토큰 설정', 'setAdminToken')
    .addItem('4. OpenAI API 키 설정(선택)', 'setOpenAIKey')
    .addItem('5. 교실 화면 코드 설정', 'setBoardKey')
    .addItem('6. 지각 체크 비밀번호 설정', 'setLateKey')
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

/* 교실 컴퓨터에 띄우는 호출 화면 전용 코드. 학급 알림장은 공개 주소라
   이 코드가 맞는 요청에만 호출 목록을 돌려준다. */
function setBoardKey() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    '교실 화면 코드 설정',
    '교실 컴퓨터에서 호출 화면을 열 때 한 번만 입력할 코드입니다. 6자 이상으로 정하세요.\n' +
    '비워서 확인하면 호출 화면을 잠급니다.',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  const key = result.getResponseText().trim();
  const props = PropertiesService.getScriptProperties();
  if (!key) {
    props.deleteProperty('BOARD_KEY_HASH');
    ui.alert('교실 화면 코드를 삭제했습니다. 호출 화면이 열리지 않습니다.');
    return;
  }
  if (key.length < 6) {
    ui.alert('코드가 너무 짧습니다. 6자 이상으로 설정해주세요.');
    return;
  }
  props.setProperty('BOARD_KEY_HASH', sha256_(key));
  ui.alert('교실 화면 코드를 저장했습니다. 교실 컴퓨터에서 한 번 입력하면 그 컴퓨터에 저장됩니다.');
}

/* 지각 체커 학생들이 학급 알림장 late/ 화면에서 쓰는 공용 비밀번호.
   이 비밀번호로는 지각 체크와 분리수거 완료 표시만 할 수 있다. */
function setLateKey() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    '지각 체크 비밀번호 설정',
    '지각 체커 친구들이 지각 체크 화면을 열 때 쓸 비밀번호입니다. 4자 이상으로 정하세요.\n' +
    '비워서 확인하면 지각 체크 화면을 잠급니다.',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  const key = result.getResponseText().trim();
  const props = PropertiesService.getScriptProperties();
  if (!key) {
    props.deleteProperty('LATE_KEY_HASH');
    ui.alert('지각 체크 비밀번호를 삭제했습니다. 지각 체크 화면이 열리지 않습니다.');
    return;
  }
  if (key.length < 4) {
    ui.alert('비밀번호가 너무 짧습니다. 4자 이상으로 설정해주세요.');
    return;
  }
  props.setProperty('LATE_KEY_HASH', sha256_(key));
  ensureClassPlannerSheets_();
  ui.alert('지각 체크 비밀번호를 저장했습니다. 체커 친구들에게만 알려주세요.');
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
    '교실 화면 코드: ' + (props.getProperty('BOARD_KEY_HASH') ? '설정됨' : '미설정 - 호출 화면 잠김') + '\n' +
    '지각 체크 비밀번호: ' + (props.getProperty('LATE_KEY_HASH') ? '설정됨' : '미설정 - 지각 체크 화면 잠김') + '\n' +
    'AI 정리: ' + (props.getProperty('OPENAI_API_KEY') ? '사용 가능' : '미설정 - 기본 정리 사용')
  );
}

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'student');
    if (action === 'health') {
      return json_({ ok: true, version: 3, service: 'class-planner' });
    }
    if (action === 'board') {
      return json_(getBoardFeed_(String((e && e.parameter && e.parameter.board) || '')));
    }
    if (action === 'late') {
      return json_(getLateFeed_(String((e && e.parameter && e.parameter.key) || ''), String((e && e.parameter && e.parameter.date) || '')));
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

    /* 교실 화면의 1인 1역 담당이 누르는 버튼. 관리자 토큰 없이 되지만
       교실 화면 코드가 필요하고, 할 수 있는 일은 전달 완료 표시뿐이다. */
    if (action === 'ackCall') {
      return json_(ackCall_(body));
    }

    /* 지각 체커가 누르는 버튼. 지각 체크 비밀번호가 필요하다. */
    if (action === 'setLate') {
      return json_(setLate_(body));
    }
    if (action === 'setDuty') {
      return json_(setDuty_(body));
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
      case 'reorderNotices': return json_(reorderNotices_(body.noticeIds || []));
      case 'createCall': return json_(createCall_(body.call || {}));
      case 'cancelCall': return json_(cancelCall_(body.callId));
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
        has_code: validStudentCode_(student),
        note: student.note || '',
      };
    }),
    calls: readObjects_('calls').filter(function (call) {
      return isCallToday_(call, today_());
    }).map(publicCall_),
    updatedAt: isoNow_(),
    aiEnabled: !!PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY'),
    boardReady: !!PropertiesService.getScriptProperties().getProperty('BOARD_KEY_HASH'),
  };
  return result;
}

function validateStudentSetup_() {
  const students = readObjects_('students').filter(isStudentActive_);
  const codeCounts = {};
  let withCode = 0;
  let invalidCodeFormats = 0;
  students.forEach(function (student) {
    const code = normalizeStudentCode_(student.personal_code);
    if (!code || !validStudentCode_(student)) {
      invalidCodeFormats += 1;
      return;
    }
    withCode += 1;
    codeCounts[code] = (codeCounts[code] || 0) + 1;
  });
  const duplicateCodes = Object.keys(codeCounts).filter(function (code) { return codeCounts[code] > 1; }).length;
  const authReady = students.length > 0 && withCode === students.length && duplicateCodes === 0 && invalidCodeFormats === 0;
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
    invalidCodeFormats: invalidCodeFormats,
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
  let nextNoticeOrder = nextNoticeSortOrder_((analysis.notices || []).length);

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
      sort_order: nextNoticeOrder,
    });
    nextNoticeOrder += 10;
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
  /* 수요일 조회 무렵 학생들이 처음 열 때 이번 주 분리수거 공지를 만든다. 실패해도 알림장은 그대로 보여준다. */
  try { ensureWeeklyRecycling_(); } catch (error) { console.error(error); }
  const students = readObjects_('students');
  const normalized = normalizeStudentCode_(code);
  const matches = normalized ? students.filter(function (row) {
    return isStudentActive_(row) && normalizeStudentCode_(row.personal_code) === normalized;
  }) : [];
  const student = matches.length === 1 ? matches[0] : null;
  const now = nowMinute_();

  const notices = readObjects_('notices').filter(function (notice) {
    if (!isNoticeLive_(notice, now)) return false;
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
      sortOrder: noticeSortValue_(notice),
    };
    if (notice.notice_type === '할일') {
      tasks.push(Object.assign({}, base, { dueDate: String(notice.due_date || notice.notice_date || '') }));
    } else {
      publicNotices.push(Object.assign({}, base, {
        content: String(notice.content || ''),
        date: String(notice.notice_date || today_()),
        dueDate: String(notice.due_date || ''),
        endsAt: String(notice.ends_at || notice.due_date || notice.notice_date || today_()),
        urgent: isTrue_(notice.urgent),
      }));
    }
  });

  /* 호출은 교실 화면(board) 전용이다. 학생 개인 기기로는 내려보내지 않는다. */
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
  const allowed = notice && isNoticeLive_(notice, nowMinute_()) && (
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

/* ── 학생 호출 ─────────────────────────────────────────────
   교무실에서 학생을 부를 때 쓴다. 교실 컴퓨터에 띄워둔 호출 화면이
   주기적으로 getBoardFeed_를 불러 새 호출을 띄운다. */

/* 오늘 만들어진 호출만 화면에 남긴다. 어제 잊고 지나간 호출이
   다음 날 아침까지 떠 있으면 아무도 믿지 않게 된다. */
function isCallToday_(call, today) {
  return callDay_(call) === String(today || '');
}

function callDay_(call) {
  return String((call && call.created_at) || '').slice(0, 10);
}

function isCallActive_(call, today) {
  return String(call && call.status) === '호출중' && isCallToday_(call, today);
}

function publicCall_(call) {
  return {
    id: String(call.call_id),
    number: Number(call.number) || 0,
    caller: String(call.caller || '담임T'),
    reason: String(call.reason || ''),
    status: String(call.status || '호출중'),
    createdAt: String(call.created_at || ''),
    ackedAt: String(call.acked_at || ''),
  };
}

function getBoardFeed_(key) {
  requireBoard_(key);
  /* 20초마다 부르는 화면이라 시트 점검·생성은 하지 않는다.
     아직 호출 탭이 없으면 "호출 없음"으로 조용히 넘긴다. */
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(APP.sheets.calls)) {
    return { ok: true, version: 3, serverTime: isoNow_(), calls: [] };
  }
  const today = today_();
  const calls = readObjects_('calls').filter(function (call) {
    return isCallToday_(call, today) && String(call.status) !== '취소';
  });
  return {
    ok: true,
    version: 3,
    serverTime: isoNow_(),
    calls: calls.map(publicCall_),
  };
}

function createCall_(call) {
  const number = Number(String(call.number || '').replace(/\D/g, ''));
  if (!Number.isInteger(number) || number < 1 || number > 99) throw new Error('호출할 학생 번호를 확인해주세요.');
  const student = readObjects_('students').filter(isStudentActive_).find(function (row) {
    return Number(row.number) === number;
  });
  if (!student) throw new Error(number + '번 학생을 명단에서 찾을 수 없습니다.');

  const today = today_();
  const existing = readObjects_('calls').find(function (row) {
    return isCallActive_(row, today) && Number(row.number) === number;
  });
  const clean = {
    call_id: existing ? String(existing.call_id) : id_('C'),
    student_id: studentId_(student),
    number: number,
    caller: String(call.caller || '담임T').trim().slice(0, 20) || '담임T',
    reason: String(call.reason || '').trim().slice(0, 60),
    status: '호출중',
    created_at: isoNow_(),
    acked_at: '',
    acked_by: '',
  };
  upsertObject_('calls', 'call_id', clean);
  audit_('호출', '학생호출', clean.call_id, number + '번 ' + (clean.reason || '사유 없음'));
  return { ok: true, call: publicCall_(clean) };
}

/* 교실 화면의 담당 학생이 누른다. 전달 완료 표시만 할 수 있고
   호출을 만들거나 지울 수는 없다. */
function ackCall_(body) {
  requireBoard_(body && body.board);
  ensureClassPlannerSheets_();
  const call = findObject_('calls', 'call_id', body && body.callId);
  if (!call) throw new Error('호출을 찾을 수 없습니다.');
  if (!isCallActive_(call, today_())) throw new Error('이미 처리되었거나 지난 호출입니다.');
  const updated = Object.assign({}, call, {
    status: '전달완료',
    acked_at: isoNow_(),
    acked_by: String((body && body.by) || '').trim().slice(0, 20),
  });
  upsertObject_('calls', 'call_id', updated);
  audit_('전달완료', '학생호출', updated.call_id, String(updated.number) + '번');
  return { ok: true, call: publicCall_(updated) };
}

function cancelCall_(callId) {
  const call = findObject_('calls', 'call_id', callId);
  if (!call) throw new Error('호출을 찾을 수 없습니다.');
  const updated = Object.assign({}, call, { status: '취소' });
  upsertObject_('calls', 'call_id', updated);
  audit_('호출취소', '학생호출', updated.call_id, String(updated.number) + '번');
  return { ok: true };
}

function requireBoard_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('BOARD_KEY_HASH');
  if (!expected) throw new Error('교실 화면 코드가 아직 설정되지 않았습니다.');
  if (!key || sha256_(String(key)) !== expected) throw new Error('교실 화면 코드가 맞지 않습니다.');
}

/* ── 지각 체크 · 목요일 분리수거 ─────────────────────────────────
   지각 체커가 날짜별로 번호를 체크하면 앱_지각기록에 쌓인다.
   수요일 07:00 이후 처음 들어온 요청이 이번 주 목요일 분리수거 당번을 정해
   학급 전체 공지로 올린다(트리거 없이 동작 — 권한 재승인이 필요 없다).
   - 지각 기록을 날짜 순서로 줄 세워 한 주에 최대 APP.recyclePerWeek명.
   - 같은 번호가 줄에 또 있으면 그 기록은 다음 주로 넘어간다.
   - 지난 당번 중 완료 체크가 없는 학생은 미완료로 바꾸고 이번 주 맨 앞에 다시 배정한다. */

function requireLateKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('LATE_KEY_HASH');
  if (!expected) throw new Error('지각 체크 비밀번호가 아직 설정되지 않았습니다.');
  if (!key || sha256_(String(key)) !== expected) throw new Error('지각 체크 비밀번호가 맞지 않습니다.');
}

function ensureLateSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(APP.sheets.lates) || !ss.getSheetByName(APP.sheets.duties)) ensureClassPlannerSheets_();
}

/* "yyyy-MM-dd" 문자열끼리만 계산한다. 서버 시간대와 상관없이 같은 결과가 나온다. */
function dateAdd_(dateStr, days) {
  const parts = String(dateStr).split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return date.getUTCFullYear() + '-' + pad2_(date.getUTCMonth() + 1) + '-' + pad2_(date.getUTCDate());
}

function weekday_(dateStr) {
  const parts = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
}

/* 지금("yyyy-MM-dd HH:mm") 정해야 할 목요일. 수요일 07:00 ~ 목요일 사이에만 값이 있다. */
function recyclingTarget_(nowText) {
  const date = String(nowText).slice(0, 10);
  const time = String(nowText).slice(11, 16);
  const day = weekday_(date);
  if (day === 3 && time >= '07:00') return dateAdd_(date, 1);
  if (day === 4) return date;
  return '';
}

function compareText_(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* 시트를 건드리지 않는 순수 계산. 테스트에서 그대로 부른다. */
function planRecycling_(target, duties, lates, perWeek) {
  const limit = Math.max(1, Number(perWeek) || 2);
  const picks = [];
  const taken = {};
  duties.filter(function (duty) {
    return String(duty.status) === '배정' && normalizeDate_(duty.duty_date) < target;
  }).sort(function (a, b) {
    return compareText_(normalizeDate_(a.duty_date), normalizeDate_(b.duty_date));
  }).forEach(function (duty) {
    const number = Number(duty.number);
    if (picks.length >= limit || taken[number]) return;
    taken[number] = true;
    picks.push({ number: number, student_id: String(duty.student_id || ''), late_ids: splitIds_(duty.late_ids), carried_from: String(duty.duty_id) });
  });
  lates.filter(function (late) {
    return String(late.status) === '유효' && !String(late.duty_id || '').trim();
  }).sort(function (a, b) {
    return compareText_(normalizeDate_(a.date) + ' ' + a.created_at, normalizeDate_(b.date) + ' ' + b.created_at);
  }).forEach(function (late) {
    const number = Number(late.number);
    if (picks.length >= limit || taken[number]) return;
    taken[number] = true;
    picks.push({ number: number, student_id: String(late.student_id || ''), late_ids: [String(late.late_id)], carried_from: '' });
  });
  return picks;
}

function ensureWeeklyRecycling_() {
  const target = recyclingTarget_(nowMinute_());
  if (!target) return null;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('RECYCLE_DONE_FOR') === target) return null;
  if (!props.getProperty('LATE_KEY_HASH')) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(APP.sheets.lates) || !ss.getSheetByName(APP.sheets.duties)) return null;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return null;
  try {
    if (props.getProperty('RECYCLE_DONE_FOR') === target) return null;
    const result = assignRecycling_(target);
    props.setProperty('RECYCLE_DONE_FOR', target);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function assignRecycling_(target) {
  const duties = readObjects_('duties');
  const lates = readObjects_('lates');
  const picks = planRecycling_(target, duties, lates, APP.recyclePerWeek);
  // 지각자가 없는 주에도 "기존 담당" 공지를 띄워 헷갈리지 않게 한다.
  const now = isoNow_();
  const numbers = picks.map(function (pick) { return pick.number; });
  const notice = recyclingNotice_(target, numbers, now);
  upsertObject_('notices', 'notice_id', notice);
  // 학급 공지는 개인 알림장에도 같이 둔다(교사 화면에 보이도록).
  upsertObject_('planner', 'item_id', {
    item_id: id_('P'),
    input_id: '',
    category: '학급',
    item_type: '일정',
    title: notice.title,
    date: target,
    due_date: '',
    note: notice.title + '\n' + notice.content,
    priority: '보통',
    status: '진행',
    linked_notice_ids: notice.notice_id,
    created_at: now,
    updated_at: now,
  });

  picks.forEach(function (pick) {
    const dutyId = id_('R');
    upsertObject_('duties', 'duty_id', {
      duty_id: dutyId,
      duty_date: target,
      number: pick.number,
      student_id: pick.student_id,
      late_ids: pick.late_ids.join(','),
      status: '배정',
      carried_from: pick.carried_from,
      notice_id: notice.notice_id,
      created_at: now,
      done_at: '',
    });
    if (pick.carried_from) {
      const old = duties.find(function (duty) { return String(duty.duty_id) === pick.carried_from; });
      upsertObject_('duties', 'duty_id', Object.assign({}, old, { status: '미완료' }));
    } else {
      const late = lates.find(function (row) { return String(row.late_id) === pick.late_ids[0]; });
      upsertObject_('lates', 'late_id', Object.assign({}, late, { duty_id: dutyId, updated_at: now }));
    }
  });
  audit_('자동배정', '분리수거', notice.notice_id,
    target + ' ' + (numbers.length ? numbers.join(',') + '번' : '지각 기록 없음 - 기존 담당'), '자동');
  return { target: target, numbers: numbers, noticeId: notice.notice_id };
}

function recyclingNotice_(target, numbers, now) {
  const parts = target.split('-').map(Number);
  const names = numbers.map(function (number) { return number + '번'; }).join(', ');
  return {
    notice_id: id_('N'),
    input_id: '',
    scope: '학급전체',
    target_student_ids: '',
    title: '분리수거 당번',
    content: parts[1] + '월 ' + parts[2] + '일(목) 분리수거 당번\n' +
      '당번: ' + (numbers.length ? names : '기존 담당'),
    notice_date: dateAdd_(target, -1),
    due_date: '',
    urgent: 'FALSE',
    notice_type: '공지',
    status: '게시됨',
    published_at: now,
    ends_at: target,
    created_at: now,
    updated_at: now,
    sort_order: nextNoticeSortOrder_(1),
    starts_at: '',
  };
}

function activeNumbers_() {
  return readObjects_('students').filter(isStudentActive_).map(function (student) {
    return Number(student.number);
  }).filter(function (number) { return number > 0; }).sort(function (a, b) { return a - b; });
}

/* 체커 화면용. 이름·개인코드 없이 번호만 내려보낸다. */
function getLateFeed_(key, date) {
  requireLateKey_(key);
  ensureLateSheets_();
  try { ensureWeeklyRecycling_(); } catch (error) { console.error(error); }
  const today = today_();
  const day = normalizeDate_(date) || today;
  const lates = readObjects_('lates').filter(function (late) { return String(late.status) === '유효'; });
  const duties = readObjects_('duties');
  const dutyDates = duties.map(function (duty) { return normalizeDate_(duty.duty_date); })
    .filter(function (value, index, list) { return value && list.indexOf(value) === index; })
    .sort().reverse().slice(0, 6);
  // 다음 배정 때 누가 먼저인지 미리 보여준다(인원 제한 없이 전체 순서).
  const pastDuties = duties.filter(function (duty) { return normalizeDate_(duty.duty_date) < today; });
  const upcoming = planRecycling_('9999-12-31', pastDuties, lates, 99);
  const assignedFor = PropertiesService.getScriptProperties().getProperty('RECYCLE_DONE_FOR') || '';
  return {
    ok: true,
    today: today,
    date: day,
    perWeek: APP.recyclePerWeek,
    numbers: activeNumbers_(),
    lates: lates.filter(function (late) { return normalizeDate_(late.date) === day; }).map(function (late) {
      return { id: String(late.late_id), number: Number(late.number), assigned: !!String(late.duty_id || '').trim() };
    }),
    duties: duties.filter(function (duty) { return dutyDates.indexOf(normalizeDate_(duty.duty_date)) >= 0; }).map(function (duty) {
      return {
        id: String(duty.duty_id), date: normalizeDate_(duty.duty_date), number: Number(duty.number),
        status: String(duty.status), carried: !!String(duty.carried_from || '').trim(),
      };
    }),
    queue: upcoming.map(function (pick) { return { number: pick.number, carried: !!pick.carried_from }; }),
    schedule: projectRecycling_(firstOpenThursday_(today, assignedFor), pastDuties, lates, APP.recyclePerWeek, 6),
  };
}

/* 아직 당번을 정하지 않은 가장 가까운 목요일. 이번 주 목요일이 지났거나 이미 정했으면 다음 주. */
function firstOpenThursday_(today, assignedFor) {
  let thursday = dateAdd_(today, (4 - weekday_(today) + 7) % 7);
  if (assignedFor && assignedFor >= thursday) thursday = dateAdd_(assignedFor, 7);
  return thursday;
}

/* 지금 기록대로라면 앞으로 어느 목요일에 누가 할지 미리 계산한다(시트는 건드리지 않음).
   미래 당번은 모두 제때 한다고 보고, 지난 당번 중 완료 체크가 없는 학생만 앞으로 끌어온다. */
function projectRecycling_(firstTarget, duties, lates, perWeek, weeks) {
  const simDuties = duties.map(function (duty) { return Object.assign({}, duty); });
  const simLates = lates.map(function (late) { return Object.assign({}, late); });
  const schedule = [];
  for (let week = 0; week < weeks; week += 1) {
    const target = dateAdd_(firstTarget, 7 * week);
    const picks = planRecycling_(target, simDuties, simLates, perWeek);
    if (!picks.length) break;
    picks.forEach(function (pick) {
      if (pick.carried_from) {
        simDuties.forEach(function (duty) { if (String(duty.duty_id) === pick.carried_from) duty.status = '미완료'; });
      } else {
        simLates.forEach(function (late) { if (String(late.late_id) === pick.late_ids[0]) late.duty_id = 'SIM'; });
      }
    });
    schedule.push({
      date: target,
      numbers: picks.map(function (pick) { return { number: pick.number, carried: !!pick.carried_from }; }),
    });
  }
  return schedule;
}

function setLate_(body) {
  requireLateKey_(body && body.key);
  ensureLateSheets_();
  const today = today_();
  const date = normalizeDate_(body.date);
  if (!date || date > today) throw new Error('오늘이나 지난 날짜만 체크할 수 있어요.');
  if (date < dateAdd_(today, -60)) throw new Error('두 달보다 오래된 날짜는 선생님께 말씀드려 주세요.');
  const number = Number(String(body.number || '').replace(/\D/g, ''));
  const student = readObjects_('students').filter(isStudentActive_).find(function (row) {
    return Number(row.number) === number;
  });
  if (!student) throw new Error(number + '번 학생을 명단에서 찾을 수 없습니다.');
  const existing = readObjects_('lates').find(function (late) {
    return String(late.status) === '유효' && normalizeDate_(late.date) === date && Number(late.number) === number;
  });
  const now = isoNow_();
  if (body.late) {
    if (existing) return { ok: true };
    upsertObject_('lates', 'late_id', {
      late_id: id_('L'), date: date, number: number, student_id: studentId_(student),
      status: '유효', duty_id: '', created_at: now, updated_at: now,
    });
    audit_('지각체크', '지각기록', date, number + '번', '지각체커');
    return { ok: true };
  }
  if (!existing) return { ok: true };
  if (String(existing.duty_id || '').trim()) {
    throw new Error('이미 분리수거 당번으로 정해진 기록이라 취소할 수 없어요. 선생님께 말씀드려 주세요.');
  }
  // 행은 지우지 않고 취소로만 표시한다(기록 보존).
  upsertObject_('lates', 'late_id', Object.assign({}, existing, { status: '취소', updated_at: now }));
  audit_('지각취소', '지각기록', date, number + '번', '지각체커');
  return { ok: true };
}

function setDuty_(body) {
  requireLateKey_(body && body.key);
  ensureLateSheets_();
  const duty = findObject_('duties', 'duty_id', body && body.dutyId);
  if (!duty) throw new Error('분리수거 기록을 찾을 수 없습니다.');
  if (String(duty.status) === '미완료') throw new Error('다음 주로 넘어간 기록이에요. 이번 주 당번 칸에서 체크해 주세요.');
  const updated = Object.assign({}, duty, body.done
    ? { status: '완료', done_at: isoNow_() }
    : { status: '배정', done_at: '' });
  upsertObject_('duties', 'duty_id', updated);
  audit_(body.done ? '분리수거완료' : '분리수거완료취소', '분리수거', updated.duty_id, String(updated.number) + '번', '지각체커');
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
  const phoneIndex = findHeaderIndex_(headers, ['휴대폰', '휴대전화', '전화번호', '학생휴대폰', '학생 휴대폰', '학생전화번호', '학생 전화번호']);
  if (numberIndex < 0 || nameIndex < 0 || (codeIndex < 0 && phoneIndex < 0)) {
    throw new Error('“명단” 시트의 첫 행에 번호, 이름과 휴대폰(또는 코드) 열이 필요합니다.');
  }

  const candidates = values.slice(1).map(function (row) {
    const number = String(row[numberIndex] || '').trim();
    const name = String(row[nameIndex] || '').trim();
    const codeSource = phoneIndex >= 0 && String(row[phoneIndex] || '').replace(/\D/g, '').length >= 4
      ? row[phoneIndex]
      : (codeIndex >= 0 ? row[codeIndex] : '');
    return {
      student_id: studentId_({ number: number }),
      number: number,
      name: name,
      personal_code: makeStudentCode_(number, codeSource),
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
      note: '번호+휴대폰 뒤 4자리로 재구성',
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
  itemId = String(itemId || '').trim();
  if (!itemId) throw new Error('삭제할 일정 ID가 없습니다.');
  const deleted = deleteObject_('planner', 'item_id', itemId);
  if (deleted) audit_('삭제', '개인알림장', itemId, '');
  return { ok: true, deleted: deleted > 0 };
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
    sort_order: nextNoticeSortOrder_(1),
    starts_at: normalizeDateTime_(notice.starts_at),
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
    // 예약 시각을 보내지 않는 화면(개인 알림장 검토함)에서 수정해도 예약이 풀려 즉시 공개되지 않게 유지
    starts_at: notice.starts_at === undefined ? current.starts_at : normalizeDateTime_(notice.starts_at),
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

function noticeSortValue_(notice) {
  const raw = String(notice && notice.sort_order !== undefined ? notice.sort_order : '').trim();
  if (!raw) return null;
  const value = Number(raw);
  return isFinite(value) ? value : null;
}

function compareNoticeOrder_(a, b) {
  const aOrder = noticeSortValue_(a);
  const bOrder = noticeSortValue_(b);
  if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
  if (aOrder !== null && bOrder === null) return -1;
  if (aOrder === null && bOrder !== null) return 1;
  return String(b.created_at || '').localeCompare(String(a.created_at || ''))
    || String(a.notice_id || '').localeCompare(String(b.notice_id || ''));
}

function nextNoticeSortOrder_(count) {
  const orders = readObjects_('notices').map(noticeSortValue_).filter(function (value) { return value !== null; });
  if (!orders.length) return 10;
  return Math.min.apply(null, orders) - (Math.max(1, Number(count) || 1) * 10);
}

function reorderNotices_(noticeIds) {
  if (!Array.isArray(noticeIds)) throw new Error('공지 순서 형식을 확인해주세요.');
  const uniqueIds = [];
  noticeIds.forEach(function (id) {
    id = String(id || '').trim();
    if (id && uniqueIds.indexOf(id) < 0) uniqueIds.push(id);
  });
  if (uniqueIds.length < 2) return { ok: true, count: uniqueIds.length };
  if (uniqueIds.length > 500) throw new Error('한 번에 정렬할 수 있는 공지는 500건입니다.');

  const notices = readObjects_('notices').sort(compareNoticeOrder_);
  const byId = {};
  notices.forEach(function (notice) { byId[String(notice.notice_id)] = notice; });
  const missing = uniqueIds.filter(function (id) { return !byId[id]; });
  if (missing.length) throw new Error('순서를 바꿀 공지 일부를 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.');

  const targetSet = {};
  uniqueIds.forEach(function (id) { targetSet[id] = true; });
  const targetPositions = [];
  notices.forEach(function (notice, index) {
    if (targetSet[String(notice.notice_id)]) targetPositions.push(index);
  });
  targetPositions.forEach(function (position, index) { notices[position] = byId[uniqueIds[index]]; });

  const orderById = {};
  notices.forEach(function (notice, index) { orderById[String(notice.notice_id)] = (index + 1) * 10; });
  const sheet = getSheet_('notices');
  const idColumn = APP.headers.notices.indexOf('notice_id') + 1;
  const orderColumn = APP.headers.notices.indexOf('sort_order') + 1;
  const rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (rowCount) {
    const rowIds = sheet.getRange(2, idColumn, rowCount, 1).getDisplayValues();
    const values = rowIds.map(function (row) {
      const id = String(row[0] || '');
      return [orderById[id] === undefined ? '' : orderById[id]];
    });
    sheet.getRange(2, orderColumn, rowCount, 1).setValues(values);
  }
  audit_('순서변경', '공지사항', '', uniqueIds.join(','));
  return { ok: true, count: uniqueIds.length };
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const width = Math.max(sheet.getLastColumn(), headers.length);
  const current = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  while (current.length && !String(current[current.length - 1]).trim()) current.pop();
  const hasHeader = current.length > 0;
  const isCompatiblePrefix = current.every(function (value, index) { return String(value) === String(headers[index]); });
  if (hasHeader && (!isCompatiblePrefix || current.length > headers.length)) {
    throw new Error(name + ' 시트의 첫 행 구조가 예상과 다릅니다. 기존 값을 확인해주세요.');
  }
  if (!hasHeader || current.length < headers.length) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
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
  const students = ss.getSheetByName(APP.sheets.students);
  const planner = ss.getSheetByName(APP.sheets.planner);
  const notices = ss.getSheetByName(APP.sheets.notices);
  if (students) students.getRange('D2:D').setNumberFormat('@');
  if (planner) {
    planner.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(APP.categories, true).build());
    planner.getRange('J2:J').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(APP.plannerStatuses, true).build());
  }
  const lates = ss.getSheetByName(APP.sheets.lates);
  if (lates) {
    // 날짜는 "2026-09-28" 텍스트로 둔다. 날짜 서식이면 표시값이 "2026. 9. 28"로 바뀐다.
    lates.getRange('B2:B').setNumberFormat('@');
    lates.getRange('E2:E').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(APP.lateStatuses, true).build());
  }
  const duties = ss.getSheetByName(APP.sheets.duties);
  if (duties) {
    duties.getRange('B2:B').setNumberFormat('@');
    duties.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(APP.dutyStatuses, true).build());
  }
  const calls = ss.getSheetByName(APP.sheets.calls);
  if (calls) {
    calls.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(APP.callStatuses, true).build());
  }
  if (notices) {
    notices.getRange('K2:K').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(APP.noticeStatuses, true).build());
    // starts_at은 "2026-09-18 08:00" 텍스트로 둔다. 날짜 서식이면 표시값이 "2026. 9. 18 오전 8:00"로 바뀐다.
    notices.getRange('Q2:Q').setNumberFormat('@');
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
  if (sheet.getLastRow() < 2) return 0;
  const ids = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  let deleted = 0;
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      deleted += 1;
    }
  }
  return deleted;
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

function audit_(action, recordType, recordId, summary, actor) {
  appendObjects_('audit', [{
    changed_at: isoNow_(), actor: actor || '관리자', action: action,
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
  const digits = String(value || '').replace(/\D/g, '');
  return /^\d{6}$/.test(digits) ? digits : '';
}

function makeStudentCode_(number, phone) {
  const parsedNumber = Number(String(number || '').replace(/\D/g, ''));
  const phoneDigits = String(phone || '').replace(/\D/g, '');
  if (!Number.isInteger(parsedNumber) || parsedNumber < 1 || parsedNumber > 99 || phoneDigits.length < 4) return '';
  return ('0' + parsedNumber).slice(-2) + phoneDigits.slice(-4);
}

function validStudentCode_(student) {
  const code = normalizeStudentCode_(student && student.personal_code);
  const parsedNumber = Number(String(student && student.number || '').replace(/\D/g, ''));
  if (!code || !Number.isInteger(parsedNumber) || parsedNumber < 1 || parsedNumber > 99) return false;
  return code.slice(0, 2) === ('0' + parsedNumber).slice(-2);
}

function findHeaderIndex_(headers, candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    const index = headers.indexOf(candidates[i]);
    if (index >= 0) return index;
  }
  return -1;
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

/* 예약 게시 시각. 입력은 "2026-09-18 08:00", "2026-09-18T08:00", 날짜만("2026-09-18" → 00:00),
   시트가 날짜로 바꿔버린 표시값("2026. 9. 18 오전 8:00:00")까지 받아 "yyyy-MM-dd HH:mm"로 맞춘다.
   알아볼 수 없는 값은 즉시 공개되지 않도록 먼 미래로 막는다. */
function normalizeDateTime_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let match = text.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (match) return formatDateTimeParts_(match[1], match[2], match[3], match[4] || 0, match[5] || 0);
  match = text.match(/^(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*(오전|오후)?\s*(\d{1,2}):(\d{2}))?/);
  if (match) {
    let hour = Number(match[5] || 0);
    if (match[4] === '오후' && hour < 12) hour += 12;
    if (match[4] === '오전' && hour === 12) hour = 0;
    return formatDateTimeParts_(match[1], match[2], match[3], hour, match[6] || 0);
  }
  return '9999-12-31 23:59';
}

function formatDateTimeParts_(year, month, day, hour, minute) {
  return year + '-' + pad2_(month) + '-' + pad2_(day) + ' ' + pad2_(hour) + ':' + pad2_(minute);
}

function nowMinute_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
}

/* 학생에게 보이는 공지: 게시됨 + 예약 시각이 없거나 이미 지남(한국 시간 분 단위). */
function isNoticeLive_(notice, now) {
  if (String(notice && notice.status) !== '게시됨') return false;
  const startsAt = normalizeDateTime_(notice.starts_at);
  return !startsAt || startsAt <= now;
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
