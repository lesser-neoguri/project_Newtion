"use client";

import { useEffect, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { Avatar } from "./ui";

interface Comment {
  id: string;
  user_id: string;
  body: string;
  resolved: boolean;
  created_at: string;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function CommentsPanel({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const { sb, me, workspace, memberMap, canEdit, role } = useWorkspace();
  const [items, setItems] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    let alive = true;
    void sb.from("comments").select("*").eq("page_id", pageId).order("created_at").then(({ data }) => {
      if (alive) setItems((data ?? []) as Comment[]);
    });
    const ch = sb
      .channel(`comments:${pageId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `page_id=eq.${pageId}` }, (p) => {
        setItems((prev) => {
          if (p.eventType === "DELETE") return prev.filter((c) => c.id !== (p.old as Comment).id);
          const c = p.new as Comment;
          const without = prev.filter((x) => x.id !== c.id);
          return [...without, c].sort((a, b) => a.created_at.localeCompare(b.created_at));
        });
      })
      .subscribe();
    return () => { alive = false; void sb.removeChannel(ch); };
  }, [sb, pageId]);

  async function submit() {
    const text = body.trim();
    if (!text) return;
    setBody("");
    const { data } = await sb.from("comments")
      .insert({ page_id: pageId, workspace_id: workspace.id, user_id: me.id, body: text })
      .select().single();
    if (data) setItems((prev) => (prev.some((c) => c.id === data.id) ? prev : [...prev, data as Comment]));
  }

  const visible = items.filter((c) => showResolved || !c.resolved);

  return (
    <aside className="fixed inset-0 z-[85] flex flex-col bg-background md:static md:z-auto md:h-full md:w-80 md:shrink-0 md:border-l md:border-line">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="font-semibold">💬 댓글</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> 해결됨 표시
          </label>
          <button onClick={onClose} className="rounded p-1 hover:bg-hover"><X size={16} /></button>
        </div>
      </div>
      <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto p-3">
        {visible.length === 0 && <p className="py-8 text-center text-sm text-muted">아직 댓글이 없습니다</p>}
        {visible.map((c) => {
          const author = memberMap.get(c.user_id);
          return (
            <div key={c.id} className={`group rounded-lg border border-line p-2.5 ${c.resolved ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2 text-sm">
                <Avatar profile={author} size={20} />
                <span className="font-medium">{author?.display_name ?? "알 수 없음"}</span>
                <span className="text-xs text-muted">{fmt(c.created_at)}</span>
                <span className="ml-auto flex touch-show opacity-0 group-hover:opacity-100">
                  {(canEdit || c.user_id === me.id) && (
                    <button title={c.resolved ? "다시 열기" : "해결"} className="rounded p-1 hover:bg-hover"
                      onClick={async () => { await sb.from("comments").update({ resolved: !c.resolved }).eq("id", c.id); }}>
                      <Check size={14} />
                    </button>
                  )}
                  {(c.user_id === me.id || role === "owner") && (
                    <button title="삭제" className="rounded p-1 text-red-500 hover:bg-hover"
                      onClick={async () => { await sb.from("comments").delete().eq("id", c.id); }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          );
        })}
      </div>
      <div className="border-t border-line p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
          }}
          rows={3}
          placeholder="댓글 남기기… (⌘/Ctrl + Enter)"
          className="w-full resize-none rounded-md border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button onClick={submit} disabled={!body.trim()} className="mt-1 w-full rounded-md bg-accent py-1.5 text-sm font-medium text-white disabled:opacity-50">
          댓글 달기
        </button>
      </div>
    </aside>
  );
}
