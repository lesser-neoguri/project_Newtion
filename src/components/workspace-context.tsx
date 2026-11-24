"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  PAGE_META_COLUMNS, type Member, type PageMeta, type Profile, type Role, type Workspace,
} from "@/lib/types";

export interface OnlineUser {
  user_id: string;
  name: string;
  color: string;
  page_id: string | null;
}

interface Ctx {
  sb: SupabaseClient;
  me: Profile;
  workspace: Workspace;
  workspaces: Workspace[];
  role: Role;
  canEdit: boolean;
  members: Member[];
  memberMap: Map<string, Profile>;
  pages: PageMeta[];
  pageMap: Map<string, PageMeta>;
  favorites: Set<string>;
  online: OnlineUser[];
  setCurrentPage: (id: string | null) => void;
  upsertPageLocal: (p: Partial<PageMeta> & { id: string }) => void;
  removePageLocal: (id: string) => void;
  toggleFavorite: (id: string) => Promise<void>;
  reloadMembers: () => Promise<void>;
  reloadWorkspace: () => Promise<void>;
  ui: {
    searchOpen: boolean;
    setSearchOpen: (v: boolean) => void;
    templatesOpen: { parentId: string | null } | null;
    setTemplatesOpen: (v: { parentId: string | null } | null) => void;
    trashOpen: boolean;
    setTrashOpen: (v: boolean) => void;
  };
}

const WorkspaceCtx = createContext<Ctx | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
}

const META_KEYS: (keyof PageMeta)[] = [
  "id", "workspace_id", "parent_id", "kind", "title", "icon", "position", "archived_at", "updated_at",
];
const pickMeta = (row: Record<string, unknown>) =>
  Object.fromEntries(META_KEYS.filter((k) => k in row).map((k) => [k, row[k]])) as Partial<PageMeta> & { id: string };

export function WorkspaceProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState<{ parentId: string | null } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const currentPage = useRef<string | null>(null);
  const presenceRef = useRef<ReturnType<SupabaseClient["channel"]> | null>(null);

  const reloadMembers = useCallback(async () => {
    const { data } = await sb
      .from("workspace_members")
      .select("user_id, role, profile:profiles(id, email, display_name, avatar_color)")
      .eq("workspace_id", workspaceId);
    setMembers(((data ?? []) as unknown as Member[]).filter((m) => m.profile));
  }, [sb, workspaceId]);

  const reloadWorkspace = useCallback(async () => {
    const { data } = await sb.from("workspaces").select("*").order("created_at");
    setWorkspaces(data ?? []);
    const ws = (data ?? []).find((w: Workspace) => w.id === workspaceId);
    if (!ws) setError("워크스페이스에 접근할 수 없습니다.");
    else setWorkspace(ws);
  }, [sb, workspaceId]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) return router.replace("/login");
      const [{ data: profile }, , , { data: pageRows }, { data: favs }] = await Promise.all([
        sb.from("profiles").select("*").eq("id", auth.user.id).single(),
        reloadWorkspace(),
        reloadMembers(),
        sb.from("pages").select(PAGE_META_COLUMNS).eq("workspace_id", workspaceId).neq("kind", "row").is("archived_at", null).order("position"),
        sb.from("page_favorites").select("page_id"),
      ]);
      if (cancelled) return;
      setMe(profile ?? { id: auth.user.id, email: auth.user.email ?? "", display_name: auth.user.email ?? "", avatar_color: "#6366f1" });
      setPages((pageRows ?? []) as PageMeta[]);
      setFavorites(new Set((favs ?? []).map((f: { page_id: string }) => f.page_id)));
      try { localStorage.setItem("newtion:lastWs", workspaceId); } catch {}
    })();
    return () => { cancelled = true; };
  }, [sb, workspaceId, reloadMembers, reloadWorkspace, router]);

  const upsertPageLocal = useCallback((p: Partial<PageMeta> & { id: string }) => {
    setPages((prev) => {
      const i = prev.findIndex((x) => x.id === p.id);
      if (i === -1) {
        if (p.kind === "row" || p.archived_at || !p.workspace_id) return prev;
        return [...prev, p as PageMeta].sort((a, b) => a.position - b.position);
      }
      const merged = { ...prev[i], ...p };
      if (merged.archived_at) return prev.filter((x) => x.id !== p.id);
      const next = [...prev];
      next[i] = merged;
      return next.sort((a, b) => a.position - b.position);
    });
  }, []);

  const removePageLocal = useCallback((id: string) => {
    setPages((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // Realtime: page tree + membership changes
  useEffect(() => {
    const ch = sb
      .channel(`ws-db:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pages", filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          if (payload.eventType === "DELETE") removePageLocal((payload.old as { id: string }).id);
          else {
            const row = payload.new as Record<string, unknown>;
            if (row.kind === "row") return;
            upsertPageLocal(pickMeta(row));
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workspace_members", filter: `workspace_id=eq.${workspaceId}` },
        () => void reloadMembers(),
      )
      .subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [sb, workspaceId, upsertPageLocal, removePageLocal, reloadMembers]);

  // Presence: who is online and which page they are looking at
  useEffect(() => {
    if (!me) return;
    const ch = sb.channel(`presence:${workspaceId}`, { config: { presence: { key: me.id } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<OnlineUser>();
      setOnline(Object.values(state).map((arr) => arr[arr.length - 1]));
    }).subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void ch.track({ user_id: me.id, name: me.display_name, color: me.avatar_color, page_id: currentPage.current });
      }
    });
    presenceRef.current = ch;
    return () => {
      presenceRef.current = null;
      void sb.removeChannel(ch);
    };
  }, [sb, workspaceId, me]);

  const setCurrentPage = useCallback(
    (id: string | null) => {
      currentPage.current = id;
      if (me && presenceRef.current) {
        void presenceRef.current.track({ user_id: me.id, name: me.display_name, color: me.avatar_color, page_id: id });
      }
    },
    [me],
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      if (!me) return;
      if (favorites.has(id)) {
        setFavorites((s) => { const n = new Set(s); n.delete(id); return n; });
        await sb.from("page_favorites").delete().eq("page_id", id).eq("user_id", me.id);
      } else {
        setFavorites((s) => new Set(s).add(id));
        await sb.from("page_favorites").insert({ page_id: id, user_id: me.id });
      }
    },
    [sb, me, favorites],
  );

  // Global shortcut: Ctrl/Cmd + K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!me || !workspace) return null;
    const role = members.find((m) => m.user_id === me.id)?.role ?? "viewer";
    return {
      sb, me, workspace, workspaces, role,
      canEdit: role !== "viewer",
      members,
      memberMap: new Map(members.map((m) => [m.user_id, m.profile])),
      pages,
      pageMap: new Map(pages.map((p) => [p.id, p])),
      favorites, online, setCurrentPage, upsertPageLocal, removePageLocal, toggleFavorite,
      reloadMembers, reloadWorkspace,
      ui: { searchOpen, setSearchOpen, templatesOpen, setTemplatesOpen, trashOpen, setTrashOpen },
    };
  }, [sb, me, workspace, workspaces, members, pages, favorites, online, setCurrentPage, upsertPageLocal,
      removePageLocal, toggleFavorite, reloadMembers, reloadWorkspace, searchOpen, templatesOpen, trashOpen]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p>{error}</p>
        <button className="rounded-md border border-line px-3 py-1.5 hover:bg-hover" onClick={() => router.push("/w")}>
          워크스페이스 목록으로
        </button>
      </div>
    );
  }
  if (!value) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      </div>
    );
  }
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}
