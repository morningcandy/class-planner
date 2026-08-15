# Claude Code 브리지 서버

개인 알림장의 Claude 요청 화면과 Claude Code CLI를 연결하는 별도 서버입니다. GitHub Pages는 정적 사이트이므로 이 폴더를 Docker 실행이 가능한 서비스에 따로 배포해야 합니다.

## 인증 원칙

- OAuth 토큰을 코드, GitHub 저장소, 브라우저에 넣지 않습니다.
- `claude setup-token`으로 만든 장기 토큰만 서버 Secret `CLAUDE_CODE_OAUTH_TOKEN`에 저장합니다.
- 브라우저 접근 보호용 `CLAUDE_BRIDGE_ACCESS_KEY`를 별도로 만듭니다. `admin1234`를 재사용하지 마세요.
- Claude Code 자식 프로세스에서는 `ANTHROPIC_API_KEY`와 `ANTHROPIC_AUTH_TOKEN`을 제거해 OAuth 환경변수가 우선 사용되도록 합니다.
- Claude의 파일·셸·MCP 도구를 모두 비활성화하고, 임시 빈 폴더에서 한 번의 응답만 실행합니다.

## 환경변수

`.env.example`을 참고해 배포 서비스의 Secret 화면에서 설정합니다.

| 이름 | 필수 | 용도 |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | 예 | `claude setup-token`으로 생성한 장기 OAuth 토큰 |
| `CLAUDE_BRIDGE_ACCESS_KEY` | 예 | 공개 API 무단 사용 방지용 별도 접속키 |
| `ALLOWED_ORIGINS` | 예 | 기본값 `https://morningcandy.github.io` |
| `CLAUDE_MODEL` | 아니요 | 기본값 `sonnet` |
| `PORT` | 아니요 | 기본값 `8080` |

## 로컬 실행

```bash
cd server
npm install
export CLAUDE_CODE_OAUTH_TOKEN="..."
export CLAUDE_BRIDGE_ACCESS_KEY="20자 이상의 별도 접속키"
npm start
```

Windows PowerShell에서는 현재 창에만 다음처럼 설정합니다.

```powershell
$env:CLAUDE_CODE_OAUTH_TOKEN = "..."
$env:CLAUDE_BRIDGE_ACCESS_KEY = "20자 이상의 별도 접속키"
npm start
```

정상 실행 후 `http://localhost:8080/health`에서 `oauthConfigured: true`를 확인합니다. 토큰 원문은 응답하거나 로그로 출력하지 않습니다.

## Docker

```bash
docker build -t class-planner-claude ./server
docker run --rm -p 8080:8080 \
  -e CLAUDE_CODE_OAUTH_TOKEN \
  -e CLAUDE_BRIDGE_ACCESS_KEY \
  -e ALLOWED_ORIGINS=https://morningcandy.github.io \
  class-planner-claude
```

배포가 끝나면 개인 알림장의 `Claude 연결 설정`에 서버의 HTTPS 주소와 브리지 접속키를 입력합니다. OAuth 토큰은 알림장 화면에 입력하지 않습니다.
