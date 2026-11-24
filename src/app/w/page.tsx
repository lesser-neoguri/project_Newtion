"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { instantiateTemplate } from "@/lib/api";
import { TEMPLATES } from "@/lib/templates";
import type { Workspace } from "@/lib/types";

const ICONS = ["🎮", "🕹️", "👾", "🐉", "🚀", "🏰", "🧩", "🎨"];

function WorkspacePicker() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const params = useSearchParams();
  const forceNew = params.get("new") === "1";
  const [list, setList] = useState<Workspace[] | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🎮");
  const [withStudio, setWithStudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await sb.rpc("accept_invites");
      const { data } = await sb.from("workspaces").select("*").order("created_at");
      const ws = (data ?? []) as Workspace[];
      if (ws.length && !forceNew) {
        let last: string | null = null;
        try { last = localStorage.getItem("newtion:lastWs"); } catch {}
        const target = ws.find((w) => w.id === last) ?? ws[0];
        router.replace(`/w/${target.id}`);
        return;
      }
      setList(ws);
    })();
  }, [sb, router, forceNew]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { data: wsId, error } = await sb.rpc("create_workspace", { p_name: name.trim() || "내 게임 스튜디오", p_icon: icon });
      if (error) throw error;
      if (withStudio) {
        const { data: auth } = await sb.auth.getUser();
        const studio = TEMPLATES.find((t) => t.id === "studio")!;
        const root = await instantiateTemplate(sb, wsId as string, auth.user!.id, null, studio.page);
        router.replace(`/w/${wsId}/p/${root.id}`);
      } else {
        router.replace(`/w/${wsId}`);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (!list) {
    return <div className="flex h-full items-center justify-center text-muted">불러오는 중…</div>;
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4">
      <form onSubmit={create} className="w-full max-w-md space-y-4">
        <div>
          <h1 className="text-2xl font-bold">새 워크스페이스 만들기</h1>
          <p className="mt-1 text-sm text-muted">팀이 함께 쓰는 공간입니다. 나중에 멤버를 초대할 수 있어요.</p>
        </div>
        <div className="flex gap-1">
          {ICONS.map((i) => (
            <button type="button" key={i} onClick={() => setIcon(i)}
              className={`rounded-md p-1.5 text-2xl ${icon === i ? "bg-hover ring-2 ring-accent" : "hover:bg-hover"}`}>{i}</button>
          ))}
        </div>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 픽셀 드래곤 스튜디오"
          className="w-full rounded-md border border-line bg-transparent px-3 py-2 outline-none focus:border-accent" />
        <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
          <input type="checkbox" checked={withStudio} onChange={(e) => setWithStudio(e.target.checked)} className="mt-0.5" />
          <span>
            <b>🎮 게임 개발 스튜디오 템플릿으로 시작</b>
            <span className="block text-muted">기획서 · 스프린트 · 버그 · 캐릭터 · 레벨 · 에셋 · 플레이테스트 · 패치노트 페이지를 자동 생성합니다.</span>
          </span>
        </label>
        {err && <p className="text-sm text-red-500">{err}</p>}
        <button disabled={busy} className="w-full rounded-md bg-accent py-2 font-semibold text-white disabled:opacity-60">
          {busy ? "만드는 중…" : "워크스페이스 만들기"}
        </button>
        {list.length > 0 && (
          <div className="pt-2">
            <div className="mb-1 text-xs text-muted">기존 워크스페이스</div>
            {list.map((w) => (
              <button type="button" key={w.id} onClick={() => router.push(`/w/${w.id}`)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
                {w.icon} {w.name}
              </button>
            ))}
          </div>
        )}
      </form>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <WorkspacePicker />
    </Suspense>
  );
}
