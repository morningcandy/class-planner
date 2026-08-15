# 개인 알림장 · 학급 알림장 통합 설계

- 최종 갱신일: 2026-08-15
- 기준 저장소: `morningcandy/class-planner`
- 연동 저장소: `morningcandy/class-notice`
- 문서 역할: 구현·배포·남은 작업의 단일 기준

## 1. 목적과 사용자

고등학교 담임교사가 쿨메신저와 전달사항을 한곳에 붙여넣어 개인 업무를 정리하고, 학생에게 전달해야 하는 내용만 검토·승인 후 학급 알림장에 게시한다.

주요 사용자는 다음과 같다.

- 교사: 개인 일정 관리, Claude 정리 요청, 공지 초안 검토·게시
- 학생: 학급 전체 공지 확인, 개인 코드로 본인 공지 확인, 확인·완료 응답
- 시스템 관리자: Google Sheets, Apps Script, Render, GitHub Pages 배포 관리

## 2. 범위

### 포함

- 개인 알림장의 `학급`, `교과`, `개인` 분류
- `/공지사항 [...]` 명령 기반 라우팅
- Claude Code OAuth 브리지를 통한 전달사항 정리
- Claude 결과의 교사 검토·수정 후 Google Sheets 반영
- 학급 및 학생 개별 공지 초안 생성
- 관리자 승인 후 학생 사이트 게시
- 학생 개인 코드 인증 및 확인·완료 응답

### 제외

- 매우 민감한 학생 상담·생활지도 내용 저장
- 학생 간 개인 공지 열람
- 관리자 승인 없는 자동 게시

## 3. 시스템 구성

| 구성 요소 | 운영 주소/위치 | 역할 | 현재 상태 |
|---|---|---|---|
| 개인 알림장 | `https://morningcandy.github.io/class-planner/` | 교사 입력·일정·공지 검토 | 배포됨, HTTP 200 확인 |
| 학급 알림장 | `https://morningcandy.github.io/class-notice/` | 학생 공지·할 일 표시 | 배포됨, HTTP 200 확인 |
| 학급 관리자 | `https://morningcandy.github.io/class-notice/admin/` | 공지 수정·게시·보류·종료 | 배포됨, HTTP 200 확인 |
| Claude 브리지 | `https://morningcandy-class-planner-bridge-260815.onrender.com` | Claude Code 실행 및 구조화 결과 반환 | Render `live`, 실제 요청 성공 |
| Apps Script | `config.js`의 `apiUrl` | 인증, Sheets 읽기·쓰기, 공개 범위 필터 | v3 스키마·운영 배포 버전 4, health 확인 완료 |
| Google Sheets | 교사 개인 스프레드시트 | 모든 업무·공지·응답의 원본 | 앱 전용 탭 6개 초기화 완료 |

## 4. 데이터 흐름

```text
교사 전달사항 입력
  → Claude 브리지에 정리 요청
  → 교사가 결과 확인·수정
  → Apps Script ingestPrepared
  → 앱_개인알림장 저장
  → [학급]/[학생개별]이면 앱_공지사항에 검토대기 생성
  → 관리자 수정·게시 승인
  → 학생 API가 게시됨 항목만 필터
  → 전체 공지 또는 개인 코드와 일치하는 개별 공지 표시
  → 학생 확인·완료 응답을 앱_학생응답에 기록
```

Claude 연결을 사용할 수 없을 때는 교사가 `/공지사항 [...]` 명령을 직접 입력하고 Apps Script의 `ingest` 경로를 사용할 수 있다.

## 5. 명령어와 라우팅

| 명령 | 개인 알림장 분류 | 공지 초안 | 공개 대상 |
|---|---|---|---|
| `/공지사항 [개인]` | 개인 | 생성하지 않음 | 교사만 |
| `/공지사항 [교과]` | 교과 | 생성하지 않음 | 교사만 |
| `/공지사항 [학급]` | 학급 | 생성 | 학급 전체 |
| `/공지사항 [학생개별: 이름]` | 학급 | 생성 | 지정 학생만 |

명령어가 공개 범위를 최종 결정한다. AI가 다른 범위를 제안하더라도 Apps Script가 명령 분류와 학생 대상을 다시 해석한다.

## 6. Google Sheets 데이터 모델

| 시트 | 주요 데이터 |
|---|---|
| `앱_학생목록` | 학생 ID, 번호, 이름, 개인 코드, 활성 여부 |
| `앱_입력함` | 원문, 명령, 분석 결과, 처리 상태, 경고 |
| `앱_개인알림장` | 분류, 유형, 제목, 날짜, 마감일, 우선순위, 상태 |
| `앱_공지사항` | 공개 범위, 대상 학생, 내용, 날짜, 상태, 게시 시각 |
| `앱_학생응답` | 학생별 확인·완료 응답 |
| `앱_변경기록` | 관리자 변경 감사 기록 |

공지 상태는 `검토대기 → 게시됨 → 종료됨`이며, `검토대기 ↔ 보류` 전환을 지원한다. 개인 일정 상태는 `진행 ↔ 완료`이다.

## 7. Apps Script 계약

### 공개 조회

- `GET ?action=health`: v3 배포 여부와 서비스 상태 확인
- `GET ?code=개인코드`: 전체 공지와 해당 학생의 개별 공지만 반환

### 학생 응답

- `POST recordResponse`: 개인 코드와 대상 항목을 검증한 후 확인·완료 기록

### 관리자 작업

- `adminLoad`
- `ingest`
- `ingestPrepared`
- `importLegacyPlanner`
- `upsertPlannerItem`, `setPlannerStatus`, `deletePlannerItem`
- `createNotice`, `updateNotice`, `setNoticeStatus`

브라우저의 CORS 사전 요청을 피하기 위해 Apps Script POST 본문은 JSON 문자열을 `text/plain`으로 전송한다.

## 8. Claude 브리지 설계

GitHub Pages는 서버 프로세스와 비밀 환경변수를 실행할 수 없으므로 Node/Docker 브리지를 Render에 별도 배포한다.

필수 환경변수:

- `CLAUDE_CODE_OAUTH_TOKEN`: `claude setup-token`으로 생성한 장기 OAuth 토큰
- `CLAUDE_BRIDGE_ACCESS_KEY`: 브라우저 요청 인증용 별도 키
- `ALLOWED_ORIGINS=https://morningcandy.github.io`
- `CLAUDE_MODEL=sonnet`

보안 원칙:

- OAuth 토큰은 Render Secret에만 저장하고 GitHub·브라우저·Sheets에 넣지 않는다.
- 접근 키는 개인 알림장 브라우저의 `sessionStorage`에만 저장한다.
- 허용 Origin, 요청 크기, 대화 길이, 출력 크기, 실행 시간, 요청 빈도를 제한한다.
- Claude의 내장 도구와 MCP 도구를 비활성화하고 임시 작업 디렉터리에서 실행한다.
- health 응답과 로그에는 비밀값의 존재 여부만 표시한다.

## 9. 배포

- `class-planner`와 `class-notice`: GitHub Pages의 `main` 브랜치
- Claude 브리지: Render 싱가포르 리전의 무료 Docker Web Service
- 브리지 설계: `render.yaml`
- 브리지 이미지: `server/` 변경 시 GitHub Actions가 GHCR 이미지 생성
- Apps Script: 저장소 코드 변경 후 Apps Script 편집기에 반영하고 기존 웹앱 배포를 새 버전으로 갱신해야 함

## 10. 주요 결정

- Google Sheets를 두 사이트의 단일 데이터 원본으로 사용한다.
- 학생 공개 전에는 반드시 관리자 승인을 거친다.
- 학생 개인 코드는 서버에서 검증하며 다른 학생의 식별 정보는 응답하지 않는다.
- Claude 결과는 자동 게시하지 않고 교사가 수정 가능한 초안으로만 사용한다.
- Claude가 정리한 명령은 `ingestPrepared`로 저장해 Apps Script에서 AI를 중복 호출하지 않는다.

## 구현된 내용

- [x] 개인 일정의 학급·교과·개인 분류와 완료 상태 관리
- [x] `/공지사항 [개인|교과|학급|학생개별]` 명령 파싱 코드
- [x] 학급·학생 개별 공지의 검토대기 생성 코드
- [x] 공지 수정·게시·보류·종료 관리자 UI
- [x] 학생 개인 코드 화면과 확인·완료 응답 UI
- [x] Claude 요청·대화·결과 검토·수정·반영 UI
- [x] OAuth 기반 Claude Code Docker 브리지
- [x] Render Secret, Origin 제한, 접근 키, 요청 제한 적용
- [x] Render 운영 배포 및 실제 Claude 요청 검증
- [x] 두 GitHub Pages 사이트와 관리자 페이지 배포
- [x] Apps Script v3 코드와 Google Sheets 앱 전용 스키마 작성
- [x] Apps Script 운영 프로젝트에 v3 버전 3을 기존 웹앱 URL로 재배포
- [x] 최초의 올바른 관리자 요청에서 관리자 토큰과 앱 전용 시트를 자동 초기화
- [x] `[개인]`, `[교과]`, `[학급]`, `[학생개별]` 명령의 저장·공개 경계 검증
- [x] `[학급]` 공지의 검토대기·게시·종료 및 학생 화면 노출 전환 검증
- [x] 개인 일정 카드의 관리자 전용 수정·삭제 버튼과 서버 권한 검증
- [x] 달력 날짜 칸의 일정 제목 및 클릭 없는 월간 전체 일정 자동 표시
- [x] `확인·완료` 같은 일반 문구를 할 일로 오분류하지 않도록 기본 분류 규칙 보완

## 남은 개발 항목

- [ ] **P0** 개인 알림장 브라우저에서 클립보드의 브리지 접근 키를 입력하고 `연결 확인`을 완료한다.
- [ ] **P0** 실제 학생 두 명의 개인 코드로 `[학생개별]` 격리와 학생 확인·완료 응답을 종단 간 테스트한다.
- [ ] **P1** 초기 관리자 비밀번호 `admin1234`를 8자 이상의 개인 비밀번호로 변경한다.
- [ ] **P1** `앱_학생목록`의 학생 ID·이름·개인 코드·활성 여부를 점검하고 코드 중복을 제거한다.
- [ ] **P1** 모바일 화면에서 학생 개인 코드 로그인, 공지 확인, 할 일 완료 동작을 확인한다.
- [ ] **P2** 비밀값이 없는 이전 Render 테스트 서비스 `class-planner-claude-bridge`를 확인 후 삭제한다.
- [ ] **P2** Google Sheets 백업 주기와 Render·Apps Script 장애 대응 절차를 정한다.

## 최근 작업

### 2026-08-15 — 개인 일정 관리·달력 자동 표시 및 학급 연계 재검증

- 개발 내용
  - 개인 일정 카드에 `수정`과 `삭제`를 직접 노출하고 기존 관리자 인증 API와 연결
  - 달력 날짜별 일정 제목을 최대 2개까지 자동 표시하고, 하단에 이번 달 전체 일정을 날짜순으로 표시
  - `확인·완료`라는 일반 단어 때문에 공지가 할 일로 분류되던 규칙을 명확한 행동 키워드 중심으로 수정
  - 수정된 Apps Script를 기존 웹앱 URL의 운영 배포 버전 4로 갱신
- 검증
  - 개인 알림장 JavaScript 문법 및 Git diff 검사 통과
  - 개인 알림장과 학급 알림장이 같은 Apps Script URL을 사용하는지 확인
  - `[학급]` 입력이 검토대기로 생성되고 `게시하기` 후 학생용 `notices`에 전체 공지로 표시됨
  - 종료 처리 후 학생용 응답에서 즉시 제외됨
- 가장 명확한 다음 단계
  - 실제 학생 두 명의 개인 코드로 학생 개별 공지 격리와 확인·완료 응답을 검증한다.

### 2026-08-15 — Apps Script v3 운영 배포 및 종단 간 반영 검증

- 개발 내용
  - 운영 Apps Script 원본을 `outputs/apps-script-backup-20260815`에 백업
  - 최초의 올바른 관리자 요청에서 관리자 토큰과 앱 전용 시트 6개를 자동 준비하도록 초기화 경로 보완
  - 최신 코드를 Apps Script 버전 3으로 만들고 기존 웹앱 배포 ID에 재배포
- 검증
  - `GET ?action=health`: `{ "ok": true, "version": 3, "service": "class-planner" }`
  - `adminLoad`: v3 응답과 앱 전용 시트 초기화 성공
  - `[개인]`: 개인 일정 생성·조회·삭제 성공, 공지 미생성 확인
  - `[교과]`: 교과 일정 생성·삭제 성공, 공지 미생성 확인
  - `[학급]`: 검토대기 생성, 승인 전 숨김, 게시 후 학생 화면 노출, 종료 후 숨김 확인
  - `[학생개별]`: 미등록 학생 대상 ID 미생성, 경고 표시, 전체 공개 차단 확인
- 가장 명확한 다음 단계
  - `앱_학생목록`에 실제 학생과 개인 코드를 입력한 뒤 두 코드 간 개별 공지 격리와 학생 응답을 검증한다.

### 2026-08-15 — Claude OAuth 브리지 운영 배포 및 전역 문서 규칙 도입

- 개발 내용
  - Claude Code 요청 화면, 결과 검토, `ingestPrepared` 반영 흐름 구현
  - Render Docker 브리지와 `render.yaml` 추가
  - `CLAUDE_CODE_OAUTH_TOKEN`, 별도 접근 키, Origin 제한 적용
  - 운영 브리지 URL을 `config.js`에 반영
  - 전역 `AGENTS.md`에 개발 전 설계 문서 확인과 개발 후 상태 갱신 규칙 추가
- 중요 커밋
  - `1c966a8`: OAuth Claude Code 브리지 워크플로
  - `430bb6c`: Render 배포 Blueprint
  - `42430af`: 인증된 운영 브리지로 전환
  - `a1d2c44`: 운영 서비스명과 Blueprint 정합화
- 검증
  - 브리지 테스트 6개 통과
  - `/health`: OAuth·접근 키 설정 확인
  - `/api/auth-check`: 성공
  - 실제 Claude `/공지사항 [개인]` 요청: 적용 가능한 결과 생성 성공
  - 개인·학급·관리자 GitHub Pages: HTTP 200
  - Apps Script 운영 URL: 응답은 성공했지만 v3 health가 아닌 학생 피드 반환
- 가장 명확한 다음 단계
  - 최신 `apps-script.gs`를 Apps Script에 배포하고 네 가지 명령의 종단 간 테스트를 수행한다.
