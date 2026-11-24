import type { DbSchema, PropValue } from "@/lib/types";
import {
  bullet, callout, code, divider, h1, h2, h3, num, p, quote, table, todo, toggle,
} from "./blocks";

export interface TemplateRow {
  title: string;
  icon?: string;
  properties: Record<string, PropValue>;
  content?: unknown[];
}

export interface TemplatePage {
  title: string;
  icon: string;
  cover?: string;
  kind: "doc" | "database";
  content?: unknown[];
  schema?: DbSchema;
  rows?: TemplateRow[];
  children?: TemplatePage[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  category: "게임 개발" | "기본";
  page: TemplatePage;
}

// ---------------------------------------------------------------------
// Shared option sets
// ---------------------------------------------------------------------
const PARTS = [
  { id: "design", name: "기획", color: "purple" },
  { id: "client", name: "클라이언트", color: "blue" },
  { id: "server", name: "서버", color: "green" },
  { id: "art", name: "아트", color: "pink" },
  { id: "sound", name: "사운드", color: "orange" },
  { id: "qa", name: "QA", color: "red" },
] as const;

const PRIORITY = [
  { id: "p0", name: "P0 긴급", color: "red" },
  { id: "p1", name: "P1 높음", color: "orange" },
  { id: "p2", name: "P2 보통", color: "yellow" },
  { id: "p3", name: "P3 낮음", color: "gray" },
] as const;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------
// 1. Game Design Document
// ---------------------------------------------------------------------
const gdd: TemplatePage = {
  title: "게임 기획서 (GDD)",
  icon: "📘",
  cover: "linear-gradient(135deg,#667eea 0%,#764ba2 100%)",
  kind: "doc",
  content: [
    callout("💡", "이 문서는 팀 전체가 공유하는 '살아있는 기획서'입니다. 변경 시 하단 변경 이력에 기록해 주세요."),
    h1("1. 개요"),
    table([
      ["항목", "내용"],
      ["가제", ""],
      ["한 줄 컨셉 (Elevator Pitch)", ""],
      ["장르", ""],
      ["플랫폼", "PC / 콘솔 / 모바일"],
      ["타겟 유저", ""],
      ["레퍼런스 게임", ""],
      ["엔진", "Unity / Unreal / Godot"],
    ]),
    h1("2. 핵심 재미 (Design Pillars)"),
    num("기둥 1 — 플레이어가 느껴야 할 감정은?"),
    num("기둥 2 — "),
    num("기둥 3 — "),
    h1("3. 코어 루프"),
    p("플레이어가 반복하는 핵심 행동의 순환을 정의합니다."),
    code("탐험 → 전투 → 보상 획득 → 성장(강화) → 더 어려운 지역 탐험", "text"),
    h2("세션 구조"),
    bullet("1회 플레이 시간: "),
    bullet("단기 목표 (분 단위): "),
    bullet("중기 목표 (시간 단위): "),
    bullet("장기 목표 (주 단위): "),
    h1("4. 게임 메커닉"),
    h3("4.1 조작"),
    table([
      ["입력", "키보드/마우스", "게임패드", "동작"],
      ["이동", "WASD", "L 스틱", ""],
      ["공격", "LMB", "X / □", ""],
      ["상호작용", "E", "A / ✕", ""],
    ]),
    h3("4.2 전투 / 핵심 시스템"),
    p(),
    h3("4.3 성장 & 경제"),
    bullet("재화 종류: "),
    bullet("획득처 (Source): "),
    bullet("소모처 (Sink): "),
    h1("5. 월드 & 내러티브"),
    toggle("세계관 설정", [p()]),
    toggle("주요 등장인물", [p("캐릭터 데이터베이스에서 관리합니다.")]),
    toggle("스토리 아크", [p()]),
    h1("6. 레벨 구성"),
    p("레벨별 상세는 '레벨 디자인 문서' 템플릿으로 작성하세요."),
    h1("7. 아트 & 사운드 디렉션"),
    bullet("아트 스타일 키워드: "),
    bullet("컬러 팔레트: "),
    bullet("사운드 무드: "),
    h1("8. UI / UX"),
    p(),
    h1("9. 비즈니스 모델"),
    p(),
    h1("10. 기술 요구사항"),
    bullet("최소 사양: "),
    bullet("목표 프레임: 60 FPS"),
    bullet("네트워크: 싱글 / P2P / 데디케이티드 서버"),
    h1("11. 마일스톤"),
    table([
      ["단계", "목표", "기간"],
      ["프로토타입", "코어 루프 검증", ""],
      ["버티컬 슬라이스", "완성도 있는 1개 스테이지", ""],
      ["알파", "모든 기능 구현", ""],
      ["베타", "콘텐츠 완성 · 버그 수정", ""],
      ["출시", "", ""],
    ]),
    h1("12. 리스크"),
    todo("범위(Scope) 과다 여부 검토"),
    todo("핵심 기술 검증 (PoC)"),
    divider(),
    h2("변경 이력"),
    bullet("YYYY-MM-DD · 작성자 · 변경 내용"),
  ],
};

// ---------------------------------------------------------------------
// 2. Sprint board
// ---------------------------------------------------------------------
const sprintSchema: DbSchema = {
  properties: [
    {
      id: "status", name: "상태", type: "status", options: [
        { id: "backlog", name: "백로그", color: "gray" },
        { id: "todo", name: "할 일", color: "blue" },
        { id: "doing", name: "진행 중", color: "yellow" },
        { id: "review", name: "리뷰", color: "purple" },
        { id: "done", name: "완료", color: "green" },
      ],
    },
    { id: "assignee", name: "담당자", type: "person" },
    { id: "part", name: "파트", type: "select", options: clone([...PARTS]) },
    { id: "priority", name: "우선순위", type: "select", options: clone([...PRIORITY]) },
    { id: "points", name: "스토리 포인트", type: "number" },
    { id: "sprint", name: "스프린트", type: "select", options: [
      { id: "s1", name: "Sprint 1", color: "blue" },
      { id: "s2", name: "Sprint 2", color: "green" },
    ] },
    { id: "due", name: "마감일", type: "date" },
  ],
  views: [
    { id: "board", name: "보드", type: "board", groupBy: "status" },
    { id: "table", name: "전체 목록", type: "table" },
    { id: "byPart", name: "파트별", type: "board", groupBy: "part" },
  ],
};

const taskBody = [
  h3("목표"), p(),
  h3("완료 조건 (Definition of Done)"),
  todo("기능 구현"), todo("코드 리뷰"), todo("QA 확인"),
  h3("참고"), p(),
];

const sprint: TemplatePage = {
  title: "스프린트 보드",
  icon: "🏃",
  kind: "database",
  schema: sprintSchema,
  rows: [
    { title: "플레이어 이동 & 점프 구현", properties: { status: "doing", part: "client", priority: "p0", points: 5, sprint: "s1" }, content: taskBody },
    { title: "메인 캐릭터 컨셉 아트", properties: { status: "review", part: "art", priority: "p1", points: 3, sprint: "s1" }, content: taskBody },
    { title: "인벤토리 시스템 기획", properties: { status: "todo", part: "design", priority: "p1", points: 3, sprint: "s1" }, content: taskBody },
    { title: "타이틀 BGM 작곡", properties: { status: "backlog", part: "sound", priority: "p2", points: 2, sprint: "s2" }, content: taskBody },
    { title: "세이브/로드 서버 API", properties: { status: "todo", part: "server", priority: "p2", points: 8, sprint: "s2" }, content: taskBody },
    { title: "프로젝트 세팅 & CI 빌드", properties: { status: "done", part: "client", priority: "p0", points: 2, sprint: "s1" }, content: taskBody },
  ],
};

// ---------------------------------------------------------------------
// 3. Bug tracker
// ---------------------------------------------------------------------
const bugBody = [
  h3("🖥️ 환경"),
  bullet("빌드 버전: "), bullet("플랫폼 / 기기: "), bullet("발생 빈도: 항상 / 가끔 / 1회"),
  h3("🔁 재현 단계"),
  num("게임 실행"), num(""), num(""),
  h3("✅ 기대 결과"), p(),
  h3("❌ 실제 결과"), p(),
  h3("📎 첨부 (스크린샷 · 영상 · 로그)"), p(),
];

const bugs: TemplatePage = {
  title: "버그 트래커",
  icon: "🐞",
  kind: "database",
  schema: {
    properties: [
      { id: "status", name: "상태", type: "status", options: [
        { id: "new", name: "신규", color: "red" },
        { id: "confirmed", name: "확인됨", color: "orange" },
        { id: "fixing", name: "수정 중", color: "yellow" },
        { id: "fixed", name: "수정 완료", color: "green" },
        { id: "verified", name: "검증 완료", color: "blue" },
        { id: "wontfix", name: "보류/재현 불가", color: "gray" },
      ] },
      { id: "severity", name: "심각도", type: "select", options: [
        { id: "blocker", name: "Blocker", color: "red" },
        { id: "critical", name: "Critical", color: "orange" },
        { id: "major", name: "Major", color: "yellow" },
        { id: "minor", name: "Minor", color: "blue" },
        { id: "trivial", name: "Trivial", color: "gray" },
      ] },
      { id: "platform", name: "플랫폼", type: "multi_select", options: [
        { id: "pc", name: "PC", color: "blue" },
        { id: "ps", name: "PlayStation", color: "purple" },
        { id: "xbox", name: "Xbox", color: "green" },
        { id: "switch", name: "Switch", color: "red" },
        { id: "ios", name: "iOS", color: "gray" },
        { id: "android", name: "Android", color: "green" },
      ] },
      { id: "area", name: "영역", type: "select", options: [
        { id: "gameplay", name: "게임플레이", color: "purple" },
        { id: "ui", name: "UI", color: "blue" },
        { id: "graphics", name: "그래픽", color: "pink" },
        { id: "audio", name: "오디오", color: "orange" },
        { id: "network", name: "네트워크", color: "green" },
        { id: "perf", name: "성능", color: "red" },
        { id: "crash", name: "크래시", color: "red" },
      ] },
      { id: "build", name: "빌드", type: "text" },
      { id: "assignee", name: "담당자", type: "person" },
      { id: "reporter", name: "보고자", type: "person" },
      { id: "reported", name: "보고일", type: "date" },
    ],
    views: [
      { id: "table", name: "전체 버그", type: "table" },
      { id: "board", name: "상태 보드", type: "board", groupBy: "status" },
      { id: "sev", name: "심각도별", type: "board", groupBy: "severity" },
    ],
  },
  rows: [
    { title: "보스 2페이즈 진입 시 클라이언트 크래시", properties: { status: "new", severity: "blocker", platform: ["pc"], area: "crash", build: "0.3.1" }, content: bugBody },
    { title: "인벤토리 아이템 아이콘이 깨져 보임", properties: { status: "confirmed", severity: "minor", platform: ["pc", "switch"], area: "ui", build: "0.3.1" }, content: bugBody },
    { title: "벽에 붙어 점프하면 맵 밖으로 이탈", properties: { status: "fixing", severity: "major", platform: ["pc", "ps"], area: "gameplay", build: "0.3.0" }, content: bugBody },
    { title: "모바일에서 30분 플레이 후 프레임 드랍", properties: { status: "new", severity: "critical", platform: ["ios", "android"], area: "perf", build: "0.3.1" }, content: bugBody },
  ],
};

// ---------------------------------------------------------------------
// 4. Characters
// ---------------------------------------------------------------------
const charBody = [
  h2("📜 배경 스토리"), p(),
  h2("🎭 성격 & 동기"), bullet("성격: "), bullet("목표/동기: "), bullet("두려움/약점: "),
  h2("⚔️ 스킬"),
  table([
    ["스킬", "타입", "쿨다운", "설명"],
    ["기본 공격", "액티브", "-", ""],
    ["스킬 1", "액티브", "8s", ""],
    ["궁극기", "액티브", "60s", ""],
    ["패시브", "패시브", "-", ""],
  ]),
  h2("🎨 비주얼 레퍼런스"), p("컨셉 아트, 무드 보드 이미지를 첨부하세요."),
  h2("🗣️ 대표 대사"), quote(""),
];

const characters: TemplatePage = {
  title: "캐릭터 시트",
  icon: "🧙",
  kind: "database",
  schema: {
    properties: [
      { id: "role", name: "역할", type: "select", options: [
        { id: "player", name: "플레이어블", color: "blue" },
        { id: "npc", name: "NPC", color: "green" },
        { id: "enemy", name: "적", color: "red" },
        { id: "boss", name: "보스", color: "purple" },
      ] },
      { id: "class", name: "클래스", type: "select", options: [
        { id: "warrior", name: "전사", color: "red" },
        { id: "mage", name: "마법사", color: "purple" },
        { id: "ranger", name: "궁수", color: "green" },
        { id: "healer", name: "힐러", color: "yellow" },
      ] },
      { id: "hp", name: "HP", type: "number" },
      { id: "atk", name: "공격력", type: "number" },
      { id: "speed", name: "이동속도", type: "number" },
      { id: "pipeline", name: "제작 단계", type: "status", options: [
        { id: "concept", name: "컨셉", color: "gray" },
        { id: "model", name: "모델링", color: "blue" },
        { id: "rig", name: "리깅", color: "purple" },
        { id: "anim", name: "애니메이션", color: "orange" },
        { id: "ingame", name: "인게임 적용", color: "green" },
      ] },
      { id: "owner", name: "담당 아티스트", type: "person" },
    ],
    views: [
      { id: "table", name: "스탯 표", type: "table" },
      { id: "board", name: "제작 파이프라인", type: "board", groupBy: "pipeline" },
    ],
  },
  rows: [
    { title: "아리아", icon: "🗡️", properties: { role: "player", class: "warrior", hp: 1200, atk: 85, speed: 5.5, pipeline: "anim" }, content: charBody },
    { title: "루멘", icon: "🔮", properties: { role: "player", class: "mage", hp: 800, atk: 120, speed: 5.0, pipeline: "rig" }, content: charBody },
    { title: "고블린 척후병", icon: "👺", properties: { role: "enemy", class: "ranger", hp: 150, atk: 20, speed: 6.0, pipeline: "ingame" }, content: charBody },
    { title: "심연의 군주", icon: "🐉", properties: { role: "boss", class: "mage", hp: 25000, atk: 300, speed: 3.5, pipeline: "concept" }, content: charBody },
  ],
};

// ---------------------------------------------------------------------
// 5. Level design document
// ---------------------------------------------------------------------
const levelDoc: TemplatePage = {
  title: "레벨 디자인 문서",
  icon: "🗺️",
  cover: "linear-gradient(135deg,#43e97b 0%,#38f9d7 100%)",
  kind: "doc",
  content: [
    table([
      ["항목", "내용"],
      ["레벨 이름", "1-1 잊혀진 숲"],
      ["예상 플레이 시간", "10분"],
      ["난이도", "★☆☆☆☆"],
      ["새로 배우는 메커닉", "이중 점프"],
      ["담당 레벨 디자이너", ""],
    ]),
    h1("🎯 레벨 목표"),
    bullet("플레이어 목표: "),
    bullet("디자인 의도 (무엇을 가르치는가?): "),
    h1("📈 비트 차트 (Beat Chart)"),
    table([
      ["구간", "이벤트", "긴장도", "메모"],
      ["A. 도입", "안전한 공간에서 조작 학습", "낮음", ""],
      ["B. 전개", "첫 전투 조우", "중간", ""],
      ["C. 위기", "함정 + 적 복합 구간", "높음", ""],
      ["D. 휴식", "세이브 포인트, 보상", "낮음", ""],
      ["E. 절정", "미니 보스", "최고", ""],
    ]),
    h1("🧭 레이아웃"),
    p("화이트박스 스크린샷 / 탑뷰 맵을 첨부하세요."),
    h1("👾 적 배치"),
    table([["위치", "적 종류", "수량", "의도"], ["", "", "", ""]]),
    h1("🧩 퍼즐 & 기믹"),
    p(),
    h1("💰 보상 & 수집 요소"),
    bullet("숨겨진 아이템: "),
    bullet("업적 연계: "),
    h1("✅ 체크리스트"),
    todo("화이트박스 완료"),
    todo("내부 플레이테스트"),
    todo("아트 드레싱"),
    todo("라이팅 & 사운드"),
    todo("최적화 (드로우콜 / 메모리)"),
    todo("최종 QA"),
  ],
};

// ---------------------------------------------------------------------
// 6. Asset tracker
// ---------------------------------------------------------------------
const assets: TemplatePage = {
  title: "에셋 트래커",
  icon: "🎨",
  kind: "database",
  schema: {
    properties: [
      { id: "status", name: "상태", type: "status", options: [
        { id: "requested", name: "요청", color: "gray" },
        { id: "wip", name: "작업 중", color: "yellow" },
        { id: "review", name: "검수", color: "purple" },
        { id: "approved", name: "승인", color: "blue" },
        { id: "inengine", name: "엔진 적용", color: "green" },
      ] },
      { id: "type", name: "타입", type: "select", options: [
        { id: "model", name: "3D 모델", color: "blue" },
        { id: "sprite", name: "2D 스프라이트", color: "pink" },
        { id: "anim", name: "애니메이션", color: "orange" },
        { id: "vfx", name: "VFX", color: "purple" },
        { id: "ui", name: "UI", color: "yellow" },
        { id: "sfx", name: "SFX", color: "green" },
        { id: "bgm", name: "BGM", color: "brown" },
      ] },
      { id: "assignee", name: "담당자", type: "person" },
      { id: "due", name: "마감일", type: "date" },
      { id: "path", name: "파일 경로", type: "url" },
      { id: "budget", name: "폴리곤/용량", type: "text" },
    ],
    views: [
      { id: "board", name: "파이프라인", type: "board", groupBy: "status" },
      { id: "table", name: "전체 에셋", type: "table" },
      { id: "type", name: "타입별", type: "board", groupBy: "type" },
    ],
  },
  rows: [
    { title: "주인공 기본 모델", properties: { status: "wip", type: "model", budget: "15k tris" } },
    { title: "검 휘두르기 이펙트", properties: { status: "requested", type: "vfx" } },
    { title: "메인 메뉴 UI 키트", properties: { status: "review", type: "ui" } },
    { title: "숲 앰비언스 루프", properties: { status: "approved", type: "sfx", budget: "2MB" } },
  ],
};

// ---------------------------------------------------------------------
// 7. Playtest feedback
// ---------------------------------------------------------------------
const playtest: TemplatePage = {
  title: "플레이테스트 피드백",
  icon: "🧪",
  kind: "database",
  schema: {
    properties: [
      { id: "tester", name: "테스터", type: "text" },
      { id: "date", name: "세션 날짜", type: "date" },
      { id: "build", name: "빌드", type: "text" },
      { id: "fun", name: "재미 점수 (1-10)", type: "number" },
      { id: "category", name: "카테고리", type: "multi_select", options: [
        { id: "onboarding", name: "온보딩", color: "blue" },
        { id: "difficulty", name: "난이도", color: "red" },
        { id: "controls", name: "조작감", color: "orange" },
        { id: "ux", name: "UI/UX", color: "purple" },
        { id: "story", name: "스토리", color: "pink" },
        { id: "balance", name: "밸런스", color: "yellow" },
      ] },
      { id: "priority", name: "우선순위", type: "select", options: clone([...PRIORITY]) },
      { id: "applied", name: "반영됨", type: "checkbox" },
    ],
    views: [
      { id: "table", name: "피드백 목록", type: "table" },
      { id: "prio", name: "우선순위별", type: "board", groupBy: "priority" },
    ],
  },
  rows: [
    { title: "튜토리얼이 너무 길다", properties: { tester: "외부 테스터 A", build: "0.2.0", fun: 6, category: ["onboarding"], priority: "p1", applied: false },
      content: [h3("관찰 내용"), p(), h3("테스터 코멘트"), quote(""), h3("개선 아이디어"), p()] },
    { title: "대시 입력이 반 박자 늦게 느껴짐", properties: { tester: "외부 테스터 B", build: "0.2.0", fun: 7, category: ["controls"], priority: "p0", applied: true } },
  ],
};

// ---------------------------------------------------------------------
// 8-10. Docs
// ---------------------------------------------------------------------
const patchNotes: TemplatePage = {
  title: "패치 노트",
  icon: "📢",
  kind: "doc",
  content: [
    h1("v0.4.0 — 2026.12.01"),
    callout("🎉", "이번 업데이트 한 줄 요약을 적어주세요."),
    h2("✨ 새로운 기능"), bullet(""),
    h2("⚖️ 밸런스 조정"),
    table([["대상", "변경 전", "변경 후"], ["", "", ""]]),
    h2("🛠️ 개선 사항"), bullet(""),
    h2("🐞 버그 수정"), bullet(""),
    h2("⚠️ 알려진 이슈"), bullet(""),
    divider(),
    h1("v0.3.0 — 2026.11.15"),
    p("이전 버전 노트는 아래에 계속 누적합니다."),
  ],
};

const meeting: TemplatePage = {
  title: "회의록 · 데일리 스크럼",
  icon: "🗓️",
  kind: "doc",
  content: [
    table([["항목", "내용"], ["일시", ""], ["참석자", ""], ["스프린트", ""]]),
    h2("👤 팀원별 공유"),
    toggle("이름", [bullet("어제 한 일: "), bullet("오늘 할 일: "), bullet("블로커: ")]),
    toggle("이름", [bullet("어제 한 일: "), bullet("오늘 할 일: "), bullet("블로커: ")]),
    h2("🧱 블로커 & 논의 사항"), bullet(""),
    h2("✅ 액션 아이템"), todo("담당자 — 할 일 — 기한"),
  ],
};

const postmortem: TemplatePage = {
  title: "포스트모템",
  icon: "🪦",
  kind: "doc",
  content: [
    callout("🧭", "비난 없는(Blameless) 회고입니다. 사람이 아니라 과정과 시스템에 집중하세요."),
    h1("프로젝트 요약"),
    table([["항목", "내용"], ["기간", ""], ["팀 규모", ""], ["결과 지표", "판매량 / 리뷰 / DAU"]]),
    h1("👍 잘된 점 (Keep)"), bullet(""),
    h1("👎 아쉬운 점 (Problem)"), bullet(""),
    h1("💡 시도해볼 것 (Try)"), bullet(""),
    h1("📊 데이터로 본 프로젝트"), p("일정 지연률, 버그 수, 크런치 시간 등"),
    h1("🎯 다음 프로젝트 액션 아이템"), todo(""),
  ],
};

const studioHome = (children: TemplatePage[]): TemplatePage => ({
  title: "게임 개발 스튜디오",
  icon: "🎮",
  cover: "linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)",
  kind: "doc",
  content: [
    callout("👋", "팀 위키 홈입니다. 아래 하위 페이지에서 기획 · 일정 · 버그 · 에셋을 관리하세요."),
    h2("📌 공지"),
    bullet("다음 마일스톤: 버티컬 슬라이스"),
    bullet("빌드 배포: 매주 금요일"),
    h2("🧭 빠른 링크"),
    bullet("📘 게임 기획서 — 게임의 모든 설계"),
    bullet("🏃 스프린트 보드 — 이번 주 할 일"),
    bullet("🐞 버그 트래커 — QA 이슈"),
    bullet("🧙 캐릭터 시트 · 🗺️ 레벨 디자인 · 🎨 에셋 트래커"),
    bullet("🧪 플레이테스트 피드백 · 📢 패치 노트"),
    h2("👥 팀 & 역할"),
    table([["이름", "역할", "연락처"], ["", "디렉터", ""], ["", "프로그래머", ""], ["", "아티스트", ""]]),
  ],
  children,
});

export const TEMPLATES: Template[] = [
  {
    id: "studio",
    name: "게임 개발 스튜디오 (전체 팩)",
    description: "팀 위키 홈과 함께 기획서·스프린트·버그·캐릭터·레벨·에셋·플레이테스트·패치노트를 한 번에 생성합니다.",
    category: "게임 개발",
    page: studioHome([gdd, sprint, bugs, characters, levelDoc, assets, playtest, patchNotes, meeting, postmortem]),
  },
  { id: "gdd", name: "게임 기획서 (GDD)", description: "컨셉, 디자인 필러, 코어 루프, 메커닉, 마일스톤까지 담은 기획서", category: "게임 개발", page: gdd },
  { id: "sprint", name: "스프린트 보드", description: "상태·파트·우선순위·스토리 포인트로 관리하는 칸반 보드", category: "게임 개발", page: sprint },
  { id: "bugs", name: "버그 트래커", description: "심각도·플랫폼·빌드·재현 단계를 포함한 QA 이슈 트래커", category: "게임 개발", page: bugs },
  { id: "characters", name: "캐릭터 시트", description: "스탯과 제작 파이프라인을 함께 관리하는 캐릭터 데이터베이스", category: "게임 개발", page: characters },
  { id: "level", name: "레벨 디자인 문서", description: "비트 차트, 적 배치, 퍼즐, 체크리스트", category: "게임 개발", page: levelDoc },
  { id: "assets", name: "에셋 트래커", description: "모델·애니·VFX·사운드 에셋의 요청부터 엔진 적용까지", category: "게임 개발", page: assets },
  { id: "playtest", name: "플레이테스트 피드백", description: "테스터 피드백을 수집하고 반영 여부를 추적", category: "게임 개발", page: playtest },
  { id: "patch", name: "패치 노트", description: "버전별 신규 기능·밸런스·버그 수정 기록", category: "게임 개발", page: patchNotes },
  { id: "meeting", name: "회의록 · 데일리 스크럼", description: "팀원별 어제/오늘/블로커 공유와 액션 아이템", category: "게임 개발", page: meeting },
  { id: "postmortem", name: "포스트모템", description: "프로젝트 종료 후 KPT 회고", category: "게임 개발", page: postmortem },
  { id: "blank", name: "빈 페이지", description: "아무것도 없는 문서에서 시작", category: "기본", page: { title: "", icon: "📄", kind: "doc", content: [] } },
  {
    id: "blank-db", name: "빈 데이터베이스", description: "표/보드 뷰를 가진 빈 데이터베이스", category: "기본",
    page: {
      title: "새 데이터베이스", icon: "🗃️", kind: "database",
      schema: {
        properties: [
          { id: "status", name: "상태", type: "status", options: [
            { id: "todo", name: "할 일", color: "gray" },
            { id: "doing", name: "진행 중", color: "blue" },
            { id: "done", name: "완료", color: "green" },
          ] },
          { id: "tags", name: "태그", type: "multi_select", options: [] },
        ],
        views: [
          { id: "table", name: "표", type: "table" },
          { id: "board", name: "보드", type: "board", groupBy: "status" },
        ],
      },
      rows: [],
    },
  },
];
