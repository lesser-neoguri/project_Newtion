"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, RotateCcw, Search, Table2, Trash2 } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { Modal } from "./ui";
import { TEMPLATES, type Template } from "@/lib/templates";
import { deleteForever, instantiateTemplate, setArchived } from "@/lib/api";
import type { PageMeta } from "@/lib/types";

export function Dialogs() {
  return (
    <>
      <SearchDialog />
      <TemplatesDialog />
      <TrashDialog />
    </>
  );
}

function PageIcon({ p }: { p: Pick<PageMeta, "icon" | "kind"> }) {
  if (p.icon) return <span className="w-5 text-center">{p.icon}</span>;
  return p.kind === "database" ? <Table2 size={16} className="text-muted" /> : <FileText size={16} className="text-muted" />;
}

function SearchDialog() {
  const { sb, workspace, pages, ui } = useWorkspace();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PageMeta[]>([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (!ui.searchOpen) return;
    const term = q.trim();
    if (!term) {
      setResults([...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 10));
      return;
    }
    const t = setTimeout(async () => {
      const safe = term.replace(/[%_\\]/g, (m) => "\\" + m);
      const { data } = await sb
        .from("pages")
        .select("id, workspace_id, parent_id, kind, title, icon, position, archived_at, updated_at")
        .eq("workspace_id", workspace.id)
        .is("archived_at", null)
        .ilike("title", `%${safe}%`)
        .order("updated_at", { ascending: false })
        .limit(20);
      setResults((data ?? []) as PageMeta[]);
      setSel(0);
    }, 150);
    return () => clearTimeout(t);
  }, [q, ui.searchOpen, sb, workspace.id, pages]);

  const close = () => { ui.setSearchOpen(false); setQ(""); };
  const go = (p: PageMeta) => { close(); router.push(`/w/${workspace.id}/p/${p.id}`); };

  return (
    <Modal open={ui.searchOpen} onClose={close}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Search size={18} className="text-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter" && results[sel]) go(results[sel]);
          }}
          placeholder={`${workspace.name}에서 검색…`}
          className="flex-1 bg-transparent outline-none"
        />
      </div>
      <div className="max-h-96 overflow-y-auto p-2">
        {!q && <div className="px-2 py-1 text-xs text-muted">최근 페이지</div>}
        {results.length === 0 && <div className="px-2 py-6 text-center text-sm text-muted">결과가 없습니다</div>}
        {results.map((p, i) => (
          <button key={p.id} onClick={() => go(p)} onMouseEnter={() => setSel(i)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${i === sel ? "bg-hover" : ""}`}>
            <PageIcon p={p} />
            <span className="truncate">{p.title || "제목 없음"}</span>
            {p.kind === "row" && <span className="ml-auto text-xs text-muted">데이터베이스 항목</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function TemplateGallery({ parentId, onDone, compact }: { parentId: string | null; onDone?: () => void; compact?: boolean }) {
  const { sb, me, workspace, canEdit, upsertPageLocal } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Template>(TEMPLATES[0]);
  const categories = useMemo(() => [...new Set(TEMPLATES.map((t) => t.category))], []);

  async function use(t: Template) {
    if (!canEdit) return;
    setBusy(t.id);
    try {
      const root = await instantiateTemplate(sb, workspace.id, me.id, parentId, t.page);
      upsertPageLocal(root);
      onDone?.();
      router.push(`/w/${workspace.id}/p/${root.id}`);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (compact) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button key={t.id} disabled={!!busy || !canEdit} onClick={() => use(t)}
            className="rounded-lg border border-line p-4 text-left transition hover:bg-hover disabled:opacity-60">
            <div className="flex items-center gap-2 font-semibold">
              <span className="text-xl">{t.page.icon}</span>
              {t.name}
            </div>
            <p className="mt-1 text-xs text-muted">{busy === t.id ? "생성 중…" : t.description}</p>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-[70vh]">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-line p-2">
        {categories.map((c) => (
          <div key={c} className="mb-3">
            <div className="px-2 py-1 text-xs font-semibold text-muted">{c}</div>
            {TEMPLATES.filter((t) => t.category === c).map((t) => (
              <button key={t.id} onClick={() => setSelected(t)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${selected.id === t.id ? "bg-hover font-medium" : "hover:bg-hover"}`}>
                <span>{t.page.icon}</span>
                <span className="truncate">{t.name}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        <div className="text-4xl">{selected.page.icon}</div>
        <h2 className="mt-2 text-2xl font-bold">{selected.name}</h2>
        <p className="mt-2 text-muted">{selected.description}</p>
        <TemplateOutline page={selected.page} />
        <div className="mt-auto pt-6">
          <button disabled={!!busy || !canEdit} onClick={() => use(selected)}
            className="rounded-md bg-accent px-4 py-2 font-semibold text-white disabled:opacity-60">
            {busy ? "생성 중…" : canEdit ? "이 템플릿 사용하기" : "뷰어는 페이지를 만들 수 없습니다"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateOutline({ page }: { page: Template["page"] }) {
  const items: string[] = [];
  if (page.kind === "database" && page.schema) {
    items.push(`속성: ${page.schema.properties.map((p) => p.name).join(", ")}`);
    items.push(`뷰: ${page.schema.views.map((v) => `${v.name}(${v.type === "board" ? "보드" : "표"})`).join(", ")}`);
    if (page.rows?.length) items.push(`예시 항목 ${page.rows.length}개`);
  }
  return (
    <div className="mt-4 space-y-1 text-sm">
      {items.map((i) => <div key={i} className="text-muted">• {i}</div>)}
      {page.children?.length ? (
        <div className="mt-3 rounded-lg border border-line p-3">
          <div className="mb-1 text-xs font-semibold text-muted">포함된 페이지</div>
          {page.children.map((c) => (
            <div key={c.title} className="py-0.5">{c.icon} {c.title}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TemplatesDialog() {
  const { ui } = useWorkspace();
  return (
    <Modal wide open={!!ui.templatesOpen} onClose={() => ui.setTemplatesOpen(null)}>
      {ui.templatesOpen && <TemplateGallery parentId={ui.templatesOpen.parentId} onDone={() => ui.setTemplatesOpen(null)} />}
    </Modal>
  );
}

function TrashDialog() {
  const { sb, workspace, ui, canEdit, upsertPageLocal } = useWorkspace();
  const [items, setItems] = useState<PageMeta[]>([]);

  const load = async () => {
    const { data } = await sb
      .from("pages")
      .select("id, workspace_id, parent_id, kind, title, icon, position, archived_at, updated_at")
      .eq("workspace_id", workspace.id)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false });
    const all = (data ?? []) as PageMeta[];
    const archivedIds = new Set(all.map((p) => p.id));
    // Show only the top of each archived subtree
    setItems(all.filter((p) => !p.parent_id || !archivedIds.has(p.parent_id)));
  };

  useEffect(() => {
    if (ui.trashOpen) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.trashOpen]);

  return (
    <Modal open={ui.trashOpen} onClose={() => ui.setTrashOpen(false)}>
      <div className="border-b border-line px-4 py-3 font-semibold">🗑️ 휴지통</div>
      <div className="max-h-96 overflow-y-auto p-2">
        {items.length === 0 && <div className="py-8 text-center text-sm text-muted">휴지통이 비어 있습니다</div>}
        {items.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover">
            <PageIcon p={p} />
            <span className="truncate">{p.title || "제목 없음"}</span>
            {canEdit && (
              <span className="ml-auto flex gap-1">
                <button title="복원" className="rounded p-1 hover:bg-hover" onClick={async () => {
                  await setArchived(sb, p.id, false);
                  upsertPageLocal({ ...p, archived_at: null });
                  // children of a restored page come back through realtime / next load
                  void load();
                }}>
                  <RotateCcw size={14} />
                </button>
                <button title="영구 삭제" className="rounded p-1 text-red-500 hover:bg-hover" onClick={async () => {
                  if (!confirm("영구 삭제하면 되돌릴 수 없습니다. 계속할까요?")) return;
                  await deleteForever(sb, p.id);
                  void load();
                }}>
                  <Trash2 size={14} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
