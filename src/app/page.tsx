import Link from "next/link";

const features = [
  { icon: "✍️", title: "블록 에디터", body: "/ 명령으로 제목, 할 일, 표, 코드, 이미지, 토글을 자유롭게." },
  { icon: "👥", title: "실시간 공동 편집", body: "같은 문서를 동시에 편집하고 서로의 커서를 확인하세요." },
  { icon: "🗃️", title: "데이터베이스", body: "표와 칸반 보드 뷰로 스프린트, 버그, 에셋을 관리." },
  { icon: "🎮", title: "게임 개발 템플릿", body: "GDD, 스프린트, 버그 트래커, 캐릭터 시트, 레벨 디자인 등." },
  { icon: "💬", title: "댓글", body: "페이지마다 토론하고 해결 상태를 추적." },
  { icon: "🔐", title: "권한 관리", body: "소유자 · 편집자 · 뷰어 권한으로 팀원을 초대." },
];

export default function Landing() {
  return (
    <main className="min-h-full">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-lg font-bold">
          <span className="text-2xl">🧩</span> Newtion
        </div>
        <Link href="/login" className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
          시작하기
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-16 pt-16 text-center">
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          게임 개발팀을 위한
          <br />
          올인원 협업 워크스페이스
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted">
          기획서부터 스프린트, 버그 트래킹, 에셋 파이프라인까지. 팀이 한 곳에서 함께 쓰고 정리합니다.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login" className="rounded-md bg-accent px-5 py-3 font-semibold text-white">
            무료로 시작하기 →
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-line p-5">
            <div className="text-2xl">{f.icon}</div>
            <div className="mt-2 font-semibold">{f.title}</div>
            <p className="mt-1 text-sm text-muted">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
