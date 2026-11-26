"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight, ChevronsUpDown, FileText, LayoutTemplate, LogOut, MoreHorizontal, Plus, Search,
  Settings, Star, Table2, Trash2, PanelLeftClose, Check, MessageCircle,
} from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { useDm } from "./dm";
import { Avatar, MenuItem, Popover } from "./ui";
import { createPage, setArchived } from "@/lib/api";
import type { PageMeta } from "@/lib/types";

const EXPANDED_KEY = "newtion:expanded";

function useExpanded() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setExpanded(new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) || "[]")));
    } catch {}
  }, []);
  const toggle = (id: string, force?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const open = force ?? !next.has(id);
      if (open) next.add(id);
      else next.delete(id);
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  return { expanded, toggle };
}

export function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const ws = useWorkspace();
  const dm = useDm();
  const { sb, me, workspace, workspaces, pages, favorites, canEdit, online, ui } = ws;
  const router = useRouter();
  const [wsMenu, setWsMenu] = useState(false);
  const { expanded, toggle } = useExpanded();

  const children = useMemo(() => {
    const map = new Map<string | null, PageMeta[]>();
    for (const p of pages) {
      const key = p.parent_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [pages]);

  async function newPage(parentId: string | null) {
    const page = await createPage(sb, { workspaceId: workspace.id, userId: me.id, parentId });
    ws.upsertPageLocal(page);
    if (parentId) toggle(parentId, true);
    router.push(`/w/${workspace.id}/p/${page.id}`);
  }

  async function signOut() {
    await sb.auth.signOut();
    router.replace("/login");
  }

  const favPages = pages.filter((p) => favorites.has(p.id));

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-line bg-sidebar text-sm md:w-64">
      {/* Workspace switcher */}
      <div className="relative flex items-center gap-1 p-2">
        <button onClick={() => setWsMenu((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
          <span className="text-lg">{workspace.icon}</span>
          <span className="truncate font-semibold">{workspace.name}</span>
          <ChevronsUpDown size={14} className="ml-auto shrink-0 text-muted" />
        </button>
        <button onClick={onCollapse} title="사이드바 닫기" className="rounded p-1.5 text-muted hover:bg-hover">
          <PanelLeftClose size={16} />
        </button>
        <Popover open={wsMenu} onClose={() => setWsMenu(false)} className="w-60">
          <div className="px-2 py-1 text-xs text-muted">{me.email}</div>
          {workspaces.map((w) => (
            <MenuItem key={w.id} onClick={() => { setWsMenu(false); router.push(`/w/${w.id}`); }}>
              <span>{w.icon}</span>
              <span className="truncate">{w.name}</span>
              {w.id === workspace.id && <Check size={14} className="ml-auto" />}
            </MenuItem>
          ))}
          <div className="my-1 border-t border-line" />
          <MenuItem onClick={() => { setWsMenu(false); router.push("/w?new=1"); }}>
            <Plus size={14} /> 새 워크스페이스
          </MenuItem>
          <MenuItem onClick={signOut}>
            <LogOut size={14} /> 로그아웃
          </MenuItem>
        </Popover>
      </div>

      <nav className="space-y-0.5 px-2">
        <NavButton icon={<Search size={16} />} label="검색" hint="⌘K" onClick={() => ui.setSearchOpen(true)} />
        <NavButton icon={<MessageCircle size={16} />} label="메시지" badge={dm.unread} onClick={() => router.push(`/w/${workspace.id}/messages`)} />
        <NavButton icon={<LayoutTemplate size={16} />} label="템플릿" onClick={() => ui.setTemplatesOpen({ parentId: null })} />
        <NavButton icon={<Settings size={16} />} label="설정 및 멤버" onClick={() => router.push(`/w/${workspace.id}/settings`)} />
        <NavButton icon={<Trash2 size={16} />} label="휴지통" onClick={() => ui.setTrashOpen(true)} />
      </nav>

      <div className="scrollbar-thin mt-3 flex-1 overflow-y-auto px-2 pb-4">
        {favPages.length > 0 && (
          <Section title="즐겨찾기">
            {favPages.map((p) => (
              <TreeItem key={p.id} page={p} depth={0} childrenMap={children} expanded={expanded} toggle={toggle} onAdd={newPage} />
            ))}
          </Section>
        )}
        <Section
          title="페이지"
          action={canEdit ? (
            <button title="새 페이지" onClick={() => newPage(null)} className="rounded p-0.5 text-muted touch-show opacity-0 hover:bg-hover group-hover:opacity-100">
              <Plus size={14} />
            </button>
          ) : null}
        >
          <RootDropZone />
          {(children.get(null) ?? []).map((p) => (
            <TreeItem key={p.id} page={p} depth={0} childrenMap={children} expanded={expanded} toggle={toggle} onAdd={newPage} />
          ))}
          {canEdit && (
            <button onClick={() => newPage(null)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-muted hover:bg-hover">
              <Plus size={16} /> 새 페이지
            </button>
          )}
        </Section>
      </div>

      <div className="flex items-center gap-1 border-t border-line px-3 py-2">
        <span className="mr-1 text-xs text-muted">접속 중</span>
        <div className="flex -space-x-1.5">
          {online.slice(0, 8).map((u) => (
            <Avatar key={u.user_id} ring size={22} profile={{ display_name: u.name, avatar_color: u.color, email: "" }} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function NavButton({ icon, label, hint, badge, onClick }: { icon: React.ReactNode; label: string; hint?: string; badge?: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-foreground/80 hover:bg-hover">
      <span className="text-muted">{icon}</span>
      {label}
      {hint && <span className="ml-auto text-xs text-muted">{hint}</span>}
      {!!badge && <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-[18px] text-white">{badge > 99 ? "99+" : badge}</span>}
    </button>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="group mb-3">
      <div className="flex items-center justify-between px-2 py-1 text-xs font-semibold text-muted">
        {title}
        {action}
      </div>
      {children}
    </div>
  );
}

const DRAG_MIME = "application/x-newtion-page";

function isDescendant(map: Map<string, PageMeta>, maybeChild: string, ancestor: string) {
  let cur = map.get(maybeChild);
  while (cur) {
    if (cur.id === ancestor) return true;
    cur = cur.parent_id ? map.get(cur.parent_id) : undefined;
  }
  return false;
}

function RootDropZone() {
  const { sb, canEdit, upsertPageLocal } = useWorkspace();
  const [over, setOver] = useState(false);
  if (!canEdit) return null;
  return (
    <div
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        setOver(false);
        const id = e.dataTransfer.getData(DRAG_MIME);
        if (!id) return;
        upsertPageLocal({ id, parent_id: null });
        await sb.from("pages").update({ parent_id: null }).eq("id", id);
      }}
      className={`h-1.5 rounded ${over ? "bg-accent/60" : ""}`}
    />
  );
}

function TreeItem({
  page, depth, childrenMap, expanded, toggle, onAdd,
}: {
  page: PageMeta;
  depth: number;
  childrenMap: Map<string | null, PageMeta[]>;
  expanded: Set<string>;
  toggle: (id: string, force?: boolean) => void;
  onAdd: (parentId: string | null) => void;
}) {
  const { sb, workspace, canEdit, pageMap, upsertPageLocal, toggleFavorite, favorites, online, me } = useWorkspace();
  const params = useParams<{ pageId?: string }>();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const kids = childrenMap.get(page.id) ?? [];
  const isOpen = expanded.has(page.id);
  const active = params.pageId === page.id;
  const viewers = online.filter((u) => u.page_id === page.id && u.user_id !== me.id);

  return (
    <div>
      <div
        draggable={canEdit}
        onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, page.id)}
        onDragOver={(e) => { if (canEdit && e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setDropOver(true); } }}
        onDragLeave={() => setDropOver(false)}
        onDrop={async (e) => {
          setDropOver(false);
          const id = e.dataTransfer.getData(DRAG_MIME);
          if (!id || id === page.id || isDescendant(pageMap, page.id, id)) return;
          upsertPageLocal({ id, parent_id: page.id });
          toggle(page.id, true);
          await sb.from("pages").update({ parent_id: page.id }).eq("id", id);
        }}
        className={`group/item relative flex items-center gap-1 rounded-md py-1 pr-1 ${active ? "bg-hover font-medium" : "hover:bg-hover"} ${dropOver ? "ring-2 ring-accent" : ""}`}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button onClick={() => toggle(page.id)} className="rounded p-0.5 text-muted hover:bg-hover">
          <ChevronRight size={14} className={`transition-transform ${isOpen ? "rotate-90" : ""} ${kids.length || page.kind === "doc" ? "" : "opacity-30"}`} />
        </button>
        <Link href={`/w/${workspace.id}/p/${page.id}`} className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="w-5 shrink-0 text-center">
            {page.icon ?? (page.kind === "database" ? <Table2 size={15} className="inline text-muted" /> : <FileText size={15} className="inline text-muted" />)}
          </span>
          <span className="truncate">{page.title || "제목 없음"}</span>
        </Link>
        {viewers.length > 0 && (
          <span className="flex -space-x-1">
            {viewers.slice(0, 3).map((v) => (
              <span key={v.user_id} title={v.name} className="h-2 w-2 rounded-full" style={{ background: v.color }} />
            ))}
          </span>
        )}
        <div className="flex items-center touch-show opacity-0 group-hover/item:opacity-100">
          <button onClick={() => setMenu(true)} className="rounded p-0.5 text-muted hover:bg-hover">
            <MoreHorizontal size={14} />
          </button>
          {canEdit && page.kind === "doc" && (
            <button title="하위 페이지 추가" onClick={() => onAdd(page.id)} className="rounded p-0.5 text-muted hover:bg-hover">
              <Plus size={14} />
            </button>
          )}
        </div>
        <Popover open={menu} onClose={() => setMenu(false)} align="right">
          <MenuItem onClick={() => { setMenu(false); void toggleFavorite(page.id); }}>
            <Star size={14} /> {favorites.has(page.id) ? "즐겨찾기 해제" : "즐겨찾기"}
          </MenuItem>
          {canEdit && (
            <MenuItem danger onClick={async () => {
              setMenu(false);
              upsertPageLocal({ id: page.id, archived_at: new Date().toISOString() });
              await setArchived(sb, page.id, true);
              if (active) router.push(`/w/${workspace.id}`);
            }}>
              <Trash2 size={14} /> 휴지통으로 이동
            </MenuItem>
          )}
        </Popover>
      </div>
      {isOpen && page.kind === "doc" && (
        <div>
          {kids.length === 0 ? (
            <div className="py-1 text-xs text-muted" style={{ paddingLeft: 30 + depth * 14 }}>하위 페이지 없음</div>
          ) : (
            kids.map((k) => (
              <TreeItem key={k.id} page={k} depth={depth + 1} childrenMap={childrenMap} expanded={expanded} toggle={toggle} onAdd={onAdd} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
