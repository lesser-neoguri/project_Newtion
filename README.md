# 🧩 Newtion

게임 개발팀을 위한 **Notion 스타일 협업 워크스페이스**입니다.
Next.js 16 · Supabase (Postgres / Auth / Realtime / Storage) · BlockNote + Yjs · Vercel 배포를 기준으로 만들었습니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| ✍️ 블록 에디터 | `/` 슬래시 메뉴로 제목, 할 일, 토글, 표, 코드, 이미지, 인용 등 (BlockNote, 한국어 UI) |
| 👥 실시간 공동 편집 | Yjs CRDT를 Supabase Realtime broadcast로 동기화. 다른 사람의 커서와 이름이 표시됨 |
| 🟢 접속자 표시 | 워크스페이스 접속자, 각 페이지를 보고 있는 사람 (Realtime Presence) |
| 🌲 페이지 트리 | 무제한 중첩, 드래그해서 다른 페이지 아래로 이동, 즐겨찾기, 휴지통(복원/영구 삭제) |
| 🗃️ 데이터베이스 | 표 뷰와 칸반 보드 뷰. 속성: 텍스트, 숫자, 선택, 다중 선택, 상태, 사람, 날짜, 체크박스, URL. 카드를 드래그해 상태 변경. 각 항목은 본문을 가진 페이지 |
| 💬 댓글 | 페이지별 댓글, 해결 처리, 실시간 반영 |
| 🔑 로그인 | GitHub, Google 계정, 이메일+비밀번호, 메일 링크(비밀번호 없이) |
| 🔐 권한 | 소유자 / 편집자 / 뷰어. 이메일로 초대 (미가입자는 가입 시 자동 참여). 모든 테이블에 RLS 적용 |
| 🤖 문서 도우미 | 오른쪽 아래 버튼. 이 페이지 / 하위 포함 / 워크스페이스 전체 범위의 문서를 바탕으로 Claude가 답변 (`ANTHROPIC_API_KEY` 필요) |
| ✨ 문서 정리 | 페이지 상단 ✨ 버튼. Claude가 문서를 정리(전체 / 맞춤법 / 구조)하고, 바뀐 줄을 컴파일러 출력창처럼 diff와 error·warning·info로 보여줌. 적용 전까지 원문 유지 |
| 📱 모바일 | 서랍형 사이드바, 터치용 버튼 표시, 전체 화면 챗봇·댓글 |
| 🌿 버전 맵 | 깃처럼 세로로 늘어진 버전 맵(`⋯ → 버전 맵`). 메인 라인 + 사용자별 라인, 사용자마다 브랜치 여러 개. 아무 노드에서 “이 버전에서 브랜치 만들어 쓰기” → 메인과 분리된 내 작업본에서 편집·커밋 → “메인에 합치기”(머지 노드). Claude·Codex(MCP) 수정은 항상 🤖 AI 커밋 노드로 따로 표시. 노드마다 의견(댓글), 지금 문서와 비교, 복원. 자동 저장·직접 저장·AI 정리 전 버전도 메인 라인에 남음 |
| 🔎 검색 | `⌘K` / `Ctrl+K` |
| 🖼️ 업로드 | 에디터 이미지/파일 업로드는 Supabase Storage `uploads` 버킷에 저장 |

## 🎮 게임 개발 템플릿

`src/lib/templates/index.ts`에 정의되어 있습니다. 새 워크스페이스를 만들 때 **게임 개발 스튜디오 팩**을 선택하면 한 번에 생성됩니다.

| 템플릿 | 종류 | 내용 |
| --- | --- | --- |
| 🎮 게임 개발 스튜디오 | 팩 | 팀 위키 홈 + 아래 템플릿 전부 |
| 📘 게임 기획서 (GDD) | 문서 | 컨셉, 디자인 필러, 코어 루프, 조작, 경제, 월드, 아트/사운드, BM, 기술 요구사항, 마일스톤, 리스크 |
| 🏃 스프린트 보드 | DB (보드) | 상태 · 담당자 · 파트 · 우선순위 · 스토리 포인트 · 스프린트 · 마감일 |
| 🐞 버그 트래커 | DB (표) | 상태 · 심각도 · 플랫폼 · 영역 · 빌드 · 담당자/보고자. 항목 본문에 재현 단계 양식 |
| 🧙 캐릭터 시트 | DB | 역할 · 클래스 · HP/공격력/이동속도 · 제작 파이프라인. 배경/스킬/대사 양식 |
| 🗺️ 레벨 디자인 문서 | 문서 | 비트 차트, 레이아웃, 적 배치, 퍼즐, 보상, 체크리스트 |
| 🎨 에셋 트래커 | DB (보드) | 요청 → 작업 중 → 검수 → 승인 → 엔진 적용 |
| 🧪 플레이테스트 피드백 | DB | 테스터 · 빌드 · 재미 점수 · 카테고리 · 우선순위 · 반영 여부 |
| 📢 패치 노트 | 문서 | 버전별 신규 기능 / 밸런스 / 버그 수정 |
| 🗓️ 회의록 · 데일리 스크럼 | 문서 | 어제 / 오늘 / 블로커, 액션 아이템 |
| 🪦 포스트모템 | 문서 | KPT 회고 |

---

## 시작하기

### 1. Supabase 설정

1. [Supabase](https://supabase.com)에서 새 프로젝트를 만듭니다.
2. **SQL Editor**에서 아래 파일을 순서대로 실행합니다. (또는 Supabase CLI로 `supabase db push`)
   - `supabase/migrations/20261124000000_init.sql`: 테이블, RLS, RPC, Realtime
   - `supabase/migrations/20261124000100_storage.sql`: 업로드 버킷
3. **Authentication → URL Configuration**
   - Site URL: `https://<your-app>.vercel.app`
   - Redirect URLs: `https://<your-app>.vercel.app/auth/callback`, `http://localhost:3000/auth/callback`
4. **GitHub 로그인** (선택)
   1. GitHub → Settings → Developer settings → [OAuth Apps → New OAuth App](https://github.com/settings/applications/new)
      - Homepage URL: `https://<your-app>.vercel.app`
      - Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`
   2. 생성 후 **Generate a new client secret**을 누르고, Client ID와 Secret을 Supabase **Authentication → Providers → GitHub**에 붙여넣고 켭니다.
   - 로그인 화면에는 Supabase에서 켜진 로그인 방식만 버튼으로 표시됩니다.
5. **Google 로그인** (선택)
   1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials)에서 **OAuth 클라이언트 ID**(웹 애플리케이션)를 만듭니다.
      - 승인된 JavaScript 원본: `https://<your-app>.vercel.app`
      - 승인된 리디렉션 URI: `https://<project-ref>.supabase.co/auth/v1/callback`
   2. Supabase **Authentication → Providers → Google**을 켜고 Client ID와 Client Secret을 붙여넣습니다.
6. (선택) 개발 중에는 **Authentication → Providers → Email**에서 *Confirm email*을 끄면 가입 즉시 로그인됩니다.

### 2. 로컬 실행

```bash
cp .env.example .env.local   # Supabase URL과 Publishable key 입력
npm install
npm run dev
```

### 3. Vercel 배포

1. Vercel에서 **Add New → Project**로 이 GitHub 저장소를 Import 합니다. (Next.js가 자동 감지됨)
2. Environment Variables를 추가합니다.
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `ANTHROPIC_API_KEY`: 문서 도우미(Claude)용. *Sensitive*로 등록하세요. 서버에서만 사용됩니다.
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Supabase → Project Settings → API Keys의 publishable key. 예전 `anon` 키도 동작)
3. Deploy를 누른 뒤, 배포된 도메인을 Supabase Auth의 Site URL / Redirect URLs에 등록합니다.

> Vercel ↔ Supabase 공식 통합(Marketplace)을 쓰면 환경변수가 자동으로 들어옵니다. 이때 변수 이름이 `NEXT_PUBLIC_SUPABASE_ANON_KEY`라면 같은 값으로 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 하나 더 추가하세요.

---

## 🕹️ 웹 게임 뷰어 (SDL2 · Emscripten)

기획서 페이지에 게임을 붙이면(`⋯ → 게임 붙이기`) 문서 옆(폰에서는 위)에서 웹 빌드를 바로 실행합니다.

- **버전**: 빌드를 올릴 때마다 버전이 쌓이고, 상단 드롭다운에서 예전 버전도 실행해 볼 수 있습니다. 최신 버전은 열려 있는 모든 탭에 바로 반영됩니다.
- **올리기**: Emscripten 결과물 폴더(`index.html`, `.js`, `.wasm`, `.data`, 에셋)를 끌어다 놓거나 폴더/.zip 선택. 파일은 Supabase Storage `games/<build_id>/…`에 저장됩니다.
- **AI 배포**: Claude Code(클라우드 포함)·Codex가 MCP로 `start_game_upload` → 스크립트 실행 → `publish_game_build`. 클라우드 세션 설정은 설정 → AI 연결 → “Claude Code 클라우드” 탭.
- **격리**: 게임은 `/g/<build_id>/…`에서 `Content-Security-Policy: sandbox`(+ iframe sandbox)로 열려 opaque origin에서 돕니다. 업로드된 코드는 Newtion 로그인 정보·저장소에 접근할 수 없고, 대신 게임 안 `localStorage`/IndexedDB 저장도 막힙니다. 큰 파일(.wasm/.data)은 스토리지로 바로 리다이렉트됩니다.
- **제약**: pthreads(SharedArrayBuffer)가 필요한 빌드는 cross-origin isolation이 필요해 지원하지 않습니다(SDL2 기본 단일 스레드 빌드는 OK). 파일 하나 크기는 Supabase 플랜의 업로드 한도(무료 50MB)를 따릅니다. 빌드 URL을 아는 사람은 누구나 실행할 수 있습니다(추측 불가능한 UUID).

## 🤖 Claude·Codex에서 Newtion 문서 고치기 (MCP)

Claude Code, Claude 데스크톱, OpenAI Codex(CLI·IDE 확장)가 내 권한으로 Newtion 문서를 읽고 고칠 수 있습니다.

1. Newtion **설정 및 멤버 → Claude 연결**에서 토큰을 발급합니다 (한 번만 표시).
2. Claude Code:
   ```bash
   claude mcp add --transport http newtion https://<your-app>.vercel.app/api/mcp --header "Authorization: Bearer <토큰>"
   ```
   Claude 데스크톱은 설정 → 데스크톱 앱 → 확장 프로그램 '관리' → 로컬 MCP 서버 '구성 편집'으로 `claude_desktop_config.json`을 열고, Newtion 설정 화면의 예시(mcp-remote, Node.js 필요)를 붙여넣은 뒤 재시작합니다.
   Codex: `~/.codex/config.toml`(Windows `%USERPROFILE%\.codex\config.toml`)에 추가합니다.
   ```toml
   [mcp_servers.newtion]
   url = "https://<your-app>.vercel.app/api/mcp"
   http_headers = { "Authorization" = "Bearer <토큰>" }
   ```
   또는 `codex mcp add newtion --url https://<your-app>.vercel.app/api/mcp --bearer-token-env-var NEWTION_TOKEN` (토큰은 환경변수 `NEWTION_TOKEN`).
3. “project_sun 기획서에서 층 종류 표에 ‘화산’ 추가해줘”처럼 요청합니다.

| 도구 | 하는 일 |
| --- | --- |
| `list_workspaces`, `list_pages`, `search`, `read_page` | 워크스페이스·페이지 트리·검색·본문(Markdown) 읽기 |
| `edit_page` | 본문에서 정확히 일치하는 문구를 찾아 바꾸기 |
| `update_page`, `append_to_page` | 본문 전체 바꾸기 / 끝에 덧붙이기 |
| `create_page`, `rename_page` | 페이지 만들기 / 제목·아이콘 바꾸기 |
| `query_database`, `add_database_row`, `update_database_row` | 데이터베이스 보기·항목 추가·수정 (속성은 이름으로) |
| `list_versions`, `read_version`, `restore_version` | 버전 기록 보기·버전 내용 읽기·복원 (복원 전 상태도 버전으로 남음) |
| `add_comment` | 댓글 달기 |
| `list_games`, `create_game`, `link_game` | 웹 게임 목록·만들기·기획서 페이지에 연결 |
| `start_game_upload`, `publish_game_build`, `list_game_builds` | 새 버전 업로드(업로드용 bash 스크립트 발급) → 게시 → 버전 목록 |

- Claude의 수정은 공동 편집자처럼 실시간 채널로 들어가, 열려 있는 탭에 바로 나타나고 바뀐 블록만 교체됩니다.
- 권한은 토큰 주인의 역할을 그대로 따릅니다 (뷰어는 읽기·댓글만). 권한 검사는 DB 함수(`mcp_*`) 안에서 하므로 서버에 관리자 키가 필요 없습니다.
- 토큰은 해시만 저장되며 설정 화면에서 언제든 폐기할 수 있습니다.

## 구조

```
src/
  app/
    page.tsx                  랜딩
    login/                    이메일+비밀번호 / 매직 링크 로그인
    auth/callback/            OAuth·매직링크 코드 교환
    w/                        워크스페이스 선택·생성
    w/[wsId]/                 사이드바 레이아웃, 홈(최근 페이지 + 템플릿)
    w/[wsId]/p/[pageId]/      페이지 (문서 / 데이터베이스 / DB 항목)
    w/[wsId]/settings/        프로필, 워크스페이스, 멤버·초대
  components/
    workspace-context.tsx     워크스페이스 상태, Realtime 페이지 트리, Presence
    sidebar.tsx               트리, 드래그 이동, 즐겨찾기
    page-view.tsx             커버·아이콘·제목·브레드크럼·속성
    editor.tsx                BlockNote + Yjs 공동 편집
    database-view.tsx         표 / 보드 뷰, 속성 관리
    comments.tsx, dialogs.tsx (검색·템플릿·휴지통)
  lib/
    yjs-supabase.ts           Yjs ↔ Supabase Realtime provider
    templates/                게임 개발 템플릿
  proxy.ts                    세션 갱신 및 /w 경로 보호
supabase/migrations/          DB 스키마
```

### 데이터 모델

- 문서, 데이터베이스, DB 항목은 모두 `pages` 테이블에 있습니다. `kind`는 `doc`, `database`, `row` 중 하나입니다.
- 문서 본문은 Yjs 상태(`ydoc`, base64)로 저장합니다. 미리보기와 첫 로드를 위해 BlockNote JSON(`content`) 스냅샷도 함께 저장합니다.
- 데이터베이스의 속성과 뷰는 `db_schema`에, 각 항목의 값은 `properties` jsonb에 들어갑니다. 값은 `set_row_property` RPC로 한 키씩 병합해, 동시에 편집해도 서로 덮어쓰지 않습니다.

### 알아둘 점

- 실시간 동기화는 Supabase Realtime broadcast를 쓰는 P2P 방식입니다. 각 편집자가 1초 디바운스로 상태를 DB에 저장합니다. 한 페이지를 동시에 수십 명이 편집하는 규모라면 Hocuspocus나 Liveblocks 같은 전용 Yjs 서버로 바꾸는 편이 낫습니다.
- `uploads` 버킷은 public-read입니다. 경로는 추측할 수 없는 UUID지만, 링크를 아는 사람은 파일을 볼 수 있습니다.
