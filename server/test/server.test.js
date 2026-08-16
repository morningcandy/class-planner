'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const ExcelJS = require('exceljs');
const { createServer, normalizeMessages, parseClaudeOutput, prepareAttachments, recognizedFiles, extractClaudeFailure, runClaude, SYSTEM_PROMPT } = require('../server');

async function withServer(run) {
  const server = createServer({
    runClaude: async () => ({ reply: '정리했습니다.', canApply: true, applyText: '/공지사항 [학급]\n체육복을 준비해주세요.' }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test.before(() => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-oauth-value';
  process.env.CLAUDE_BRIDGE_ACCESS_KEY = 'test-bridge-access-key-long';
  process.env.ALLOWED_ORIGINS = 'https://morningcandy.github.io';
});

test('health only reports whether secrets are configured', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/health`, { headers: { Origin: 'https://morningcandy.github.io' } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.oauthConfigured, true);
    assert.equal(body.promptVersion, 7);
    assert.equal(body.buildRevision, 'long-attachments-student-codes-v7');
    assert.equal(JSON.stringify(body).includes('test-oauth-value'), false);
  });
});

test('rejects an invalid bridge key', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/claude`, {
      method: 'POST',
      headers: { Origin: 'https://morningcandy.github.io', 'Content-Type': 'application/json', 'X-Bridge-Key': 'wrong' },
      body: JSON.stringify({ prompt: '정리해줘' }),
    });
    assert.equal(response.status, 401);
  });
});

test('returns structured Claude output with a valid key', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/claude`, {
      method: 'POST',
      headers: { Origin: 'https://morningcandy.github.io', 'Content-Type': 'application/json', 'X-Bridge-Key': 'test-bridge-access-key-long' },
      body: JSON.stringify({ prompt: '체육복 안내를 정리해줘', messages: [] }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.canApply, true);
    assert.match(body.applyText, /^\/공지사항 \[학급\]/);
  });
});

test('checks bridge authentication without running Claude', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/auth-check`, {
      method: 'POST',
      headers: { Origin: 'https://morningcandy.github.io', 'X-Bridge-Key': 'test-bridge-access-key-long' },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.oauthConfigured, true);
  });
});

test('blocks unapproved browser origins', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(response.status, 403);
  });
});

test('normalizes history and parses Claude envelopes', () => {
  assert.deepEqual(normalizeMessages([{ role: 'assistant', content: '좋습니다.' }]), [{ role: 'assistant', content: '좋습니다.' }]);
  const parsed = parseClaudeOutput(JSON.stringify({ structured_output: { reply: '완료', canApply: false, items: [], readFiles: [] } }));
  assert.deepEqual(parsed, { reply: '완료', canApply: false, applyText: '', items: [], readFiles: [] });
});

test('instructs Claude to split independent checklist items', () => {
  assert.match(SYSTEM_PROMPT, /별도 items 원소로 나누세요/);
  assert.match(SYSTEM_PROMPT, /학생에게 알릴 필요가 없는 교사 업무는 \[개인\]/);
  assert.match(SYSTEM_PROMPT, /다운로드 링크를 학생에게 제공하지 말고/);
  assert.match(SYSTEM_PROMPT, /마크다운 표/);
});

test('converts structured items into deterministic apply blocks', () => {
  const parsed = parseClaudeOutput(JSON.stringify({ structured_output: {
    reply: '두 항목으로 정리했습니다.', canApply: true,
    readFiles: [], items: [
      { scope: '학급', targets: [], title: '학생 등교', content: '8월 18일 08시까지' },
      { scope: '개인', targets: [], title: '교직원회의', content: '8월 18일 08시 10분' },
    ],
  } }));
  assert.equal(parsed.items.length, 2);
  assert.match(parsed.applyText, /^\/공지사항 \[학급\]/);
  assert.match(parsed.applyText, /\n---\n\/공지사항 \[개인\]/);
});

test('converts an xlsx attachment into readable text', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-attachment-test-'));
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('일정');
    sheet.addRow(['날짜', '내용']);
    sheet.addRow(['2026-08-18', '개학식']);
    const buffer = await workbook.xlsx.writeBuffer();
    const context = await prepareAttachments(dir, [{ name: '일정.xlsx', data: Buffer.from(buffer).toString('base64') }]);
    assert.match(context, /엑셀 텍스트 변환본/);
    const converted = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8');
    assert.match(converted, /개학식/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recognizes PDF and image attachments with explicit reading methods', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-document-test-'));
  try {
    const files = [
      { name: '가정통신문.pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') },
      { name: '시간표.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') },
    ];
    const context = await prepareAttachments(dir, files);
    assert.match(context, /첨부파일 2개/);
    assert.match(context, /하나씩 모두 Read/);
    assert.deepEqual(recognizedFiles(files), [
      { name: '가정통신문.pdf', method: 'PDF 문서 읽기' },
      { name: '시간표.jpg', method: '이미지 내용 읽기' },
    ]);
    assert.equal(fs.readdirSync(dir).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writes the Claude prompt to stdin instead of waiting for piped input', async () => {
  let received = '';
  let capturedArgs = [];
  const result = await runClaude('표준입력 전달 점검', [], {
    spawnProcess: (_executable, args) => {
      capturedArgs = args;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, _encoding, done) { received += chunk.toString('utf8'); done(); } });
      child.kill = () => {};
      child.stdin.on('finish', () => {
        child.stdout.end(JSON.stringify({ structured_output: { reply: '완료', canApply: false, items: [], readFiles: [] } }));
        setImmediate(() => child.emit('close', 0));
      });
      return child;
    },
  });
  assert.equal(received, '표준입력 전달 점검');
  assert.equal(capturedArgs.includes('표준입력 전달 점검'), false);
  assert.equal(capturedArgs[capturedArgs.indexOf('--max-turns') + 1], '3');
  assert.equal(result.reply, '완료');
});

test('allows additional Claude turns when reading an attachment', async () => {
  let received = '';
  let capturedArgs = [];
  const result = await runClaude('첨부파일 정리', [{ name: '안내.txt', data: Buffer.from('개학 안내').toString('base64') }], {
    spawnProcess: (_executable, args) => {
      capturedArgs = args;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, _encoding, done) { received += chunk.toString('utf8'); done(); } });
      child.kill = () => {};
      child.stdin.on('finish', () => {
        child.stdout.end(JSON.stringify({ structured_output: { reply: '완료', canApply: false, items: [], readFiles: ['안내.txt'] } }));
        setImmediate(() => child.emit('close', 0));
      });
      return child;
    },
  });
  assert.equal(capturedArgs[capturedArgs.indexOf('--max-turns') + 1], '8');
  assert.match(received, /첨부파일 1개가 있습니다/);
  assert.match(received, /\.\/attachment-1-/);
  assert.deepEqual(result.recognizedFiles, [{ name: '안내.txt', method: '텍스트 읽기' }]);
});

test('rejects a Claude result that did not confirm every attachment was read', async () => {
  await assert.rejects(() => runClaude('첨부파일 정리', [{ name: '누락.pdf', data: Buffer.from('%PDF-1.4').toString('base64') }], {
    spawnProcess: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
      child.kill = () => {};
      child.stdin.on('finish', () => {
        child.stdout.end(JSON.stringify({ structured_output: { reply: '완료', canApply: false, items: [], readFiles: [] } }));
        setImmediate(() => child.emit('close', 0));
      });
      return child;
    },
  }), /읽었다고 확인하지 못했습니다: 누락.pdf/);
});

test('extracts a safe Claude CLI failure from JSON stdout', () => {
  const detail = extractClaudeFailure(
    JSON.stringify({ type: 'result', subtype: 'error_during_execution', result: 'Login expired for sk-ant-secret-value' }),
    '',
    1
  );
  assert.match(detail, /Login expired/);
  assert.equal(detail.includes('sk-ant-secret-value'), false);
});
