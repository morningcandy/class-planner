'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, normalizeMessages, parseClaudeOutput } = require('../server');

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
  const parsed = parseClaudeOutput(JSON.stringify({ structured_output: { reply: '완료', canApply: false, applyText: '' } }));
  assert.deepEqual(parsed, { reply: '완료', canApply: false, applyText: '' });
});
