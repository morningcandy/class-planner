'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_BODY_BYTES = 256 * 1024;
const MAX_PROMPT_CHARS = 12000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CHARS = 24000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 10;

const RESPONSE_SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    canApply: { type: 'boolean' },
    applyText: { type: 'string' },
  },
  required: ['reply', 'canApply', 'applyText'],
});

const SYSTEM_PROMPT = `당신은 한국 고등학교 담임교사의 개인 알림장 정리 도우미입니다.
사용자의 질문에는 간결하고 실용적인 한국어로 답하세요.
전달사항, 쿨메신저, 일정 또는 공지를 붙여넣은 경우 핵심 내용과 날짜를 정리하세요.
알림장에 바로 반영할 준비가 되었을 때만 canApply를 true로 설정하고 applyText를 작성하세요.
applyText 첫 줄은 반드시 다음 중 하나여야 합니다.
/공지사항 [학급]
/공지사항 [교과]
/공지사항 [개인]
/공지사항 [학생개별: 학생이름]
그 아래에는 제목과 전달 내용을 자연스럽게 작성하세요. 사용자가 제공하지 않은 날짜, 학생 이름, 사실은 만들지 마세요.
전체 학생에게 알려야 하면 학급, 교과 수업 관련이면 교과, 교사만 볼 업무면 개인, 특정 학생만 대상이면 학생개별을 선택하세요.
단순 질문이나 추가 정보가 필요한 경우 canApply는 false이고 applyText는 빈 문자열이어야 합니다.
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
    catch { result = { reply: result, canApply: false, applyText: '' }; }
  }
  if (!result || typeof result !== 'object') throw new Error('Claude 응답을 해석하지 못했습니다.');
  return {
    reply: String(result.reply || '').trim(),
    canApply: result.canApply === true && !!String(result.applyText || '').trim(),
    applyText: String(result.applyText || '').trim(),
  };
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'class-planner-claude-'));
    const executable = process.env.CLAUDE_BIN || path.join(
      __dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'claude.cmd' : 'claude'
    );
    const model = String(process.env.CLAUDE_MODEL || 'sonnet');
    const timeoutMs = Math.min(Math.max(Number(process.env.CLAUDE_TIMEOUT_MS) || 120000, 15000), 300000);
    const childEnv = { ...process.env, CI: 'true', CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1' };
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.ANTHROPIC_AUTH_TOKEN;

    const args = [
      '-p', '--output-format', 'json', '--json-schema', RESPONSE_SCHEMA,
      '--model', model, '--max-turns', '1', '--no-session-persistence',
      '--safe-mode', '--tools', '', '--disallowedTools', 'mcp__*',
      '--disable-slash-commands', '--system-prompt', SYSTEM_PROMPT, prompt,
    ];
    const child = spawn(executable, args, { cwd: tempDir, env: childEnv, windowsHide: true });
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
    child.on('error', (error) => finish(new Error(`Claude Code를 실행하지 못했습니다: ${error.message}`)));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim().split('\n').slice(-3).join(' ');
        return finish(new Error(detail || `Claude Code가 상태 ${code}로 종료되었습니다.`));
      }
      try { finish(null, parseClaudeOutput(Buffer.concat(stdout).toString('utf8'))); }
      catch (error) { finish(error); }
    });
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
      const result = await invokeClaude(buildPrompt(prompt, body.messages));
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

module.exports = { createServer, buildPrompt, normalizeMessages, parseClaudeOutput, safeEqual };
