"use client";

import Link from "next/link";
import { FileText, Table2 } from "lucide-react";
import { useWorkspace } from "@/components/workspace-context";
import { TemplateGallery } from "@/components/dialogs";

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "늦은 밤이에요";
  if (h < 12) return "좋은 아침이에요";
  if (h < 18) return "좋은 오후예요";
  return "좋은 저녁이에요";
}

export default function WorkspaceHome() {
  const { me, workspace, pages } = useWorkspace();
  const recent = [...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8);

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-10 py-14">
        <h1 className="text-3xl font-bold">{greeting()}, {me.display_name}님 👋</h1>
        <p className="mt-1 text-muted">{workspace.icon} {workspace.name}</p>

        {recent.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-sm font-semibold text-muted">🕘 최근 방문</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recent.map((p) => (
                <Link key={p.id} href={`/w/${workspace.id}/p/${p.id}`} className="rounded-xl border border-line p-4 hover:bg-hover">
                  <div className="text-2xl">
                    {p.icon ?? (p.kind === "database" ? <Table2 className="text-muted" /> : <FileText className="text-muted" />)}
                  </div>
                  <div className="mt-2 truncate font-medium">{p.title || "제목 없음"}</div>
                  <div className="mt-1 text-xs text-muted">{new Date(p.updated_at).toLocaleDateString("ko-KR")}</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="mt-12">
          <h2 className="mb-3 text-sm font-semibold text-muted">🎮 템플릿으로 시작하기</h2>
          <TemplateGallery parentId={null} compact />
        </section>
      </div>
    </div>
  );
}
