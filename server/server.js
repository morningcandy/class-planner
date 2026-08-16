'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');

const MAX_BODY_BYTES = 18 * 1024 * 1024;
const MAX_PROMPT_CHARS = 12000;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 15 * 1024 * 1024;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CHARS = 24000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 10;
const PROMPT_VERSION = 6;
const BUILD_REVISION = 'attachment-content-tables-v6';

const RESPONSE_SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    canApply: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: { type: 'string', enum: ['개인', '교과', '학급', '학생개별'] },
          targets: { type: 'array', items: { type: 'string' } },
          title: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['scope', 'targets', 'title', 'content'],
      },
    },
    readFiles: { type: 'array', items: { type: 'string' } },
  },
  required: ['reply', 'canApply', 'items', 'readFiles'],
});

const SYSTEM_PROMPT = `당신은 한국 고등학교 담임교사의 개인 알림장 정리 도우미입니다.
사용자의 질문에는 간결하고 실용적인 한국어로 답하세요.
전달사항, 쿨메신저, 일정 또는 공지를 붙여넣은 경우 핵심 내용과 날짜를 정리하세요.
알림장에 바로 반영할 준비가 되었을 때만 canApply를 true로 설정하고 items 배열을 작성하세요. 준비되지 않았으면 items는 빈 배열입니다.
각 items 원소는 서로 독립적으로 완료 체크하거나 게시 여부를 결정할 수 있는 단위여야 합니다. 제목·내용·날짜 맥락을 각 원소에 완결되게 넣으세요.
사용자가 제공하지 않은 날짜, 학생 이름, 사실은 만들지 마세요.
전체 학생에게 알려야 하면 학급, 교과 수업 관련이면 교과, 교사만 볼 업무면 개인, 특정 학생만 대상이면 학생개별을 선택하세요.
서로 독립적으로 확인하거나 완료할 수 있는 일정·업무·번호 목록은 반드시 별도 items 원소로 나누세요. 공통 날짜와 필요한 맥락은 각 원소에 반복하세요.
교직원회의처럼 학생에게 알릴 필요가 없는 교사 업무는 [개인]으로, 학생에게 안내할 내용만 [학급] 또는 [학생개별]로 분류하세요.
단순한 설명 문단은 별도 체크 항목으로 만들지 말고 관련 항목의 맥락으로 포함하세요.
첨부파일이 있으면 모든 파일을 빠짐없이 Read로 읽고, 파일명만 보고 추측하지 마세요.
첨부파일 자체나 다운로드 링크를 학생에게 제공하지 말고 파일에서 읽은 내용을 title과 content에 옮겨 정리하세요.
시간표·일정표처럼 행과 열이 있는 자료는 학생용 content에 마크다운 표(| 열 | 열 | 형식)를 넣어 원래 행·열 관계를 보존하세요.
표의 각 셀은 원문에 있는 내용만 사용하고, 읽기 어렵거나 확정할 수 없는 값은 추측하지 말고 reply에서 교사에게 확인을 요청하세요.
첨부파일을 실제로 Read한 뒤에만 그 원래 파일명을 readFiles 배열에 넣으세요. 첨부가 없으면 빈 배열로 두세요.
학생개별이면 targets에 대상 학생 이름을 넣고, 그 외에는 targets를 빈 배열로 두세요.
단순 질문이나 추가 정보가 필요한 경우 canApply는 false이고 items는 빈 배열이어야 합니다.
응답은 지정된 JSON 스키마만 따르세요.`;

function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || 'https://morningcandy.github.io')
    .split(',').map((value) => value.trim()).filter(Boolean);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function clientIp(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || request.socket.remoteAddress || 'unknown';
}

function createRateLimiter() {
  const buckets = new Map();
  return function check(ip) {
    const now = Date.now();
    const current = buckets.get(ip);
    if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
      buckets.set(ip, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= RATE_LIMIT;
  };
}

function corsHeaders(origin) {
  const allowed = allowedOrigins();
  const selected = allowed.includes(origin) ? origin : '';
  return {
    ...(selected ? { 'Access-Control-Allow-Origin': selected } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Bridge-Key',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

function sendJson(response, status, value, origin = '') {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('요청 내용이 너무 깁니다.'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('JSON 요청 형식이 올바르지 않습니다.'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) return [];
  let used = 0;
  return value.slice(-MAX_HISTORY_MESSAGES).map((message) => {
    const role = message && message.role === 'assistant' ? 'assistant' : 'user';
    let content = String(message?.content || '').trim();
    const remaining = Math.max(0, MAX_HISTORY_CHARS - used);
    content = content.slice(0, remaining);
    used += content.length;
    return { role, content };
  }).filter((message) => message.content);
}

function buildPrompt(prompt, messages) {
  const history = normalizeMessages(messages);
  const transcript = history.length
    ? history.map((message) => `${message.role === 'assistant' ? '도우미' : '교사'}: ${message.content}`).join('\n\n')
    : '(이전 대화 없음)';
  return `이전 대화:\n${transcript}\n\n교사의 새 요청:\n${prompt}`;
}

function parseClaudeOutput(stdout) {
  const envelope = JSON.parse(stdout);
  let result = envelope.structured_output || envelope.structuredOutput || envelope.result;
  if (typeof result === 'string') {
    const trimmed = result.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    try { result = JSON.parse(trimmed); }
    catch { result = { reply: result, canApply: false, items: [] }; }
  }
  if (!result || typeof result !== 'object') throw new Error('Claude 응답을 해석하지 못했습니다.');
  const items = Array.isArray(result.items) ? result.items.map((item) => ({
    scope: ['개인', '교과', '학급', '학생개별'].includes(item?.scope) ? item.scope : '개인',
    targets: Array.isArray(item?.targets) ? item.targets.map((value) => String(value).trim()).filter(Boolean) : [],
    title: String(item?.title || '').trim(),
    content: String(item?.content || '').trim(),
  })).filter((item) => item.title || item.content) : [];
  const applyText = items.length ? items.map((item) => {
    const label = item.scope === '학생개별' ? `학생개별: ${item.targets.join(', ')}` : item.scope;
    return `/공지사항 [${label}]\n${[item.title, item.content].filter(Boolean).join('\n')}`;
  }).join('\n---\n') : String(result.applyText || '').trim();
  return {
    reply: String(result.reply || '').trim(),
    canApply: result.canApply === true && !!applyText,
    applyText,
    items,
    readFiles: Array.isArray(result.readFiles) ? result.readFiles.map((value) => path.basename(String(value || '').trim())).filter(Boolean) : [],
  };
}

function sanitizeCliError(value) {
  return String(value || '')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[CLAUDE TOKEN]')
    .replace(/(CLAUDE_CODE_OAUTH_TOKEN\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

function extractClaudeFailure(stdoutText, stderrText, code) {
  const candidates = [];
  const stderr = String(stderrText || '').trim();
  if (stderr) candidates.push(stderr.split('\n').slice(-4).join(' '));
  const stdout = String(stdoutText || '').trim();
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout);
      [parsed?.error?.message, parsed?.error, parsed?.message, parsed?.result, parsed?.subtype]
        .filter((value) => typeof value === 'string' && value.trim())
        .forEach((value) => candidates.push(value));
    } catch {
      candidates.push(stdout.split('\n').slice(-3).join(' '));
    }
  }
  const detail = sanitizeCliError(candidates.find((value) => sanitizeCliError(value)) || '');
  return detail || `Claude Code가 상태 ${code}로 종료되었습니다.`;
}

async function prepareAttachments(tempDir, files) {
  if (!Array.isArray(files) || !files.length) return '';
  if (files.length > MAX_FILES) throw new Error(`첨부파일은 최대 ${MAX_FILES}개까지 가능합니다.`);
  let total = 0;
  const references = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index] || {};
    const original = path.basename(String(file.name || `file-${index + 1}`));
    const ext = path.extname(original).toLowerCase();
    if (!['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.xlsx', '.csv', '.txt'].includes(ext)) {
      throw new Error(`${original}: 지원하지 않는 파일 형식입니다.`);
    }
    const buffer = Buffer.from(String(file.data || ''), 'base64');
    if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error(`${original}: 파일 크기는 6MB 이하여야 합니다.`);
    total += buffer.length;
    if (total > MAX_TOTAL_FILE_BYTES) throw new Error('첨부파일 전체 크기는 15MB 이하여야 합니다.');
    const safeBase = `attachment-${index + 1}`;
    if (ext === '.xlsx') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const rows = [];
      workbook.eachSheet((sheet) => {
        rows.push(`[시트: ${sheet.name}]`);
        sheet.eachRow((row) => {
          const values = [];
          for (let column = 1; column <= row.cellCount; column += 1) values.push(row.getCell(column).text);
          rows.push(values.join('\t'));
        });
      });
      const target = `${safeBase}-${original.replace(/[^0-9A-Za-z가-힣._-]/g, '_')}.txt`;
      fs.writeFileSync(path.join(tempDir, target), rows.join('\n').slice(0, 500000), 'utf8');
      references.push(`${original} (엑셀 텍스트 변환본: ./${target})`);
    } else {
      const target = `${safeBase}-${original.replace(/[^0-9A-Za-z가-힣._-]/g, '_')}`;
      fs.writeFileSync(path.join(tempDir, target), buffer);
      references.push(`${original} (./${target})`);
    }
  }
  return `\n\n첨부파일 ${references.length}개가 있습니다. 아래 파일을 하나씩 모두 Read한 뒤 내용을 확인하여 교사의 요청과 함께 정리하세요. 파일을 읽지 않고 이름만으로 추측해서는 안 됩니다.\n${references.map((value, index) => `${index + 1}. ${value}`).join('\n')}\n시간표·일정표 등 격자 자료는 학생에게 파일 링크를 주지 말고 content 안에 마크다운 표로 옮기세요.`;
}

function recognizedFiles(files) {
  return (Array.isArray(files) ? files : []).map((file) => {
    const name = path.basename(String(file && file.name || '첨부파일'));
    const ext = path.extname(name).toLowerCase();
    return {
      name,
      method: ext === '.xlsx' ? '표·셀 텍스트 변환' : (ext === '.pdf' ? 'PDF 문서 읽기' : (/^\.(png|jpe?g|webp|gif)$/.test(ext) ? '이미지 내용 읽기' : '텍스트 읽기')),
    };
  });
}

async function runClaude(prompt, files = [], options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'class-planner-claude-'));
  let attachmentPrompt = '';
  try { attachmentPrompt = await prepareAttachments(tempDir, files); }
  catch (error) { fs.rmSync(tempDir, { recursive: true, force: true }); throw error; }
  return new Promise((resolve, reject) => {
    const executable = process.env.CLAUDE_BIN || path.join(
      __dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'claude.cmd' : 'claude'
    );
    const model = String(process.env.CLAUDE_MODEL || 'sonnet');
    const timeoutMs = Math.min(Math.max(Number(process.env.CLAUDE_TIMEOUT_MS) || 120000, 15000), 300000);
    const defaultMaxTurns = attachmentPrompt ? 6 : 3;
    const maxTurns = Math.min(Math.max(Number(process.env.CLAUDE_MAX_TURNS) || defaultMaxTurns, 2), 8);
    const childEnv = { ...process.env, CI: 'true', CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1' };
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.ANTHROPIC_AUTH_TOKEN;

    const args = [
      '-p', '--output-format', 'json', '--json-schema', RESPONSE_SCHEMA,
      '--model', model, '--max-turns', String(maxTurns), '--no-session-persistence',
      '--safe-mode', '--permission-mode', 'dontAsk', '--tools', attachmentPrompt ? 'Read' : '',
      ...(attachmentPrompt ? ['--allowedTools', 'Read(./**)'] : []),
      '--disallowedTools', 'mcp__*',
      '--disable-slash-commands', '--system-prompt', SYSTEM_PROMPT,
    ];
    const userInput = prompt + attachmentPrompt;
    const spawnProcess = options.spawnProcess || spawn;
    const child = spawnProcess(executable, args, { cwd: tempDir, env: childEnv, windowsHide: true });
    const stdout = [];
    const stderr = [];
    let outputSize = 0;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Claude 응답 시간이 초과되었습니다.'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      outputSize += chunk.length;
      if (outputSize > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        return finish(new Error('Claude 응답이 허용 크기를 초과했습니다.'));
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (Buffer.concat(stderr).length < 12000) stderr.push(chunk);
    });
    child.stdin.on('error', (error) => finish(new Error(`Claude 입력을 전달하지 못했습니다: ${error.message}`)));
    child.on('error', (error) => finish(new Error(`Claude Code를 실행하지 못했습니다: ${error.message}`)));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = extractClaudeFailure(
          Buffer.concat(stdout).toString('utf8'),
          Buffer.concat(stderr).toString('utf8'),
          code
        );
        return finish(new Error(detail));
      }
      try {
        const parsed = parseClaudeOutput(Buffer.concat(stdout).toString('utf8'));
        const expectedFiles = recognizedFiles(files);
        const reported = new Set(parsed.readFiles);
        const unread = expectedFiles.filter((file) => !reported.has(file.name));
        if (unread.length) {
          return finish(new Error(`Claude가 다음 첨부파일을 읽었다고 확인하지 못했습니다: ${unread.map((file) => file.name).join(', ')}`));
        }
        finish(null, {
          ...parsed,
          recognizedFiles: expectedFiles,
        });
      }
      catch (error) { finish(error); }
    });
    child.stdin.end(userInput);
  });
}

function createServer(options = {}) {
  const invokeClaude = options.runClaude || runClaude;
  const rateLimit = createRateLimiter();
  let busy = false;

  return http.createServer(async (request, response) => {
    const origin = String(request.headers.origin || '');
    const url = new URL(request.url, 'http://localhost');

    if (origin && !allowedOrigins().includes(origin)) {
      return sendJson(response, 403, { ok: false, error: '허용되지 않은 사이트입니다.' }, origin);
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders(origin));
      return response.end();
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, {
        ok: true,
        service: 'class-planner-claude-bridge',
        oauthConfigured: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
        accessKeyConfigured: !!process.env.CLAUDE_BRIDGE_ACCESS_KEY,
        model: process.env.CLAUDE_MODEL || 'sonnet',
        promptVersion: PROMPT_VERSION,
        buildRevision: BUILD_REVISION,
      }, origin);
    }
    if (request.method !== 'POST' || (url.pathname !== '/api/claude' && url.pathname !== '/api/auth-check')) {
      return sendJson(response, 404, { ok: false, error: '요청한 주소가 없습니다.' }, origin);
    }
    if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      return sendJson(response, 503, { ok: false, error: '서버에 CLAUDE_CODE_OAUTH_TOKEN이 설정되지 않았습니다.' }, origin);
    }
    if (!process.env.CLAUDE_BRIDGE_ACCESS_KEY) {
      return sendJson(response, 503, { ok: false, error: '서버에 CLAUDE_BRIDGE_ACCESS_KEY가 설정되지 않았습니다.' }, origin);
    }
    if (!safeEqual(request.headers['x-bridge-key'], process.env.CLAUDE_BRIDGE_ACCESS_KEY)) {
      return sendJson(response, 401, { ok: false, error: 'Claude 브리지 접속키가 올바르지 않습니다.' }, origin);
    }
    if (url.pathname === '/api/auth-check') {
      return sendJson(response, 200, { ok: true, oauthConfigured: true, model: process.env.CLAUDE_MODEL || 'sonnet' }, origin);
    }
    if (!rateLimit(clientIp(request))) {
      return sendJson(response, 429, { ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, origin);
    }
    if (busy) {
      return sendJson(response, 429, { ok: false, error: '이전 Claude 요청을 처리 중입니다.' }, origin);
    }

    try {
      const body = await readJson(request);
      const prompt = String(body.prompt || '').trim();
      if (!prompt) return sendJson(response, 400, { ok: false, error: 'Claude에게 보낼 내용을 입력해주세요.' }, origin);
      if (prompt.length > MAX_PROMPT_CHARS) return sendJson(response, 413, { ok: false, error: '한 번에 입력할 수 있는 글자 수를 초과했습니다.' }, origin);
      busy = true;
      const result = await invokeClaude(buildPrompt(prompt, body.messages), body.files);
      return sendJson(response, 200, { ok: true, ...result }, origin);
    } catch (error) {
      const status = Number(error.status) || 500;
      return sendJson(response, status, { ok: false, error: error.message || 'Claude 요청을 처리하지 못했습니다.' }, origin);
    } finally {
      busy = false;
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  createServer().listen(port, '0.0.0.0', () => {
    console.log(`Claude bridge listening on port ${port}`);
  });
}

module.exports = { createServer, buildPrompt, normalizeMessages, parseClaudeOutput, safeEqual, prepareAttachments, recognizedFiles, extractClaudeFailure, runClaude, SYSTEM_PROMPT };
