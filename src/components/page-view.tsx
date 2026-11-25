"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronRight, FileText, History, ImageIcon, Link2, MessageSquare, MoreHorizontal, Plus, Smile, Star, Table2, Trash2,
  RotateCcw, LayoutTemplate,
} from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { Avatar, EmojiPicker, MenuItem, Popover, Spinner } from "./ui";
import { DatabaseView } from "./database-view";
import { PropertyCell } from "./property-cell";
import { CommentsPanel } from "./comments";
import { TidyBar, TidyReview, useTidy } from "./tidy";
import { VersionPreview, useSnapshot, type PageVersion } from "./versions";
import { VersionMap, type Commit } from "./version-map";
import { BranchBanner, useBranching } from "./branching";
import type { BlockNoteEditor } from "./editor";
import { aiHub } from "@/lib/ai-hub";
import { selectionToAttachment } from "@/lib/selection";
import { createPage, deleteForever, setArchived } from "@/lib/api";
import { COVERS, type DbSchema, type Page, type PageMeta, type PropValue, type PropOption } from "@/lib/types";

const CollaborativeEditor = dynamic(() => import("./editor"), { ssr: false, loading: () => <Spinner /> });

export function PageView({ pageId }: { pageId: string }) {
  const ws = useWorkspace();
  const { sb, me, workspace, canEdit, pageMap, pages, online, favorites, toggleFavorite, upsertPageLocal, setCurrentPage, memberMap } = ws;
  const router = useRouter();
  const [page, setPage] = useState<Page | null>(null);
  const [parentDb, setParentDb] = useState<Page | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error" | null>(null);
  const [menu, setMenu] = useState(false);
  const [iconPicker, setIconPicker] = useState(false);
  // Remember which document (main or a branch) the editor instance belongs to,
  // so a stale editor is never used after switching between them.
  const [edState, setEdState] = useState<{ ed: BlockNoteEditor | null; key: string }>({ ed: null, key: "" });
  const [showVersions, setShowVersions] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<PageVersion | null>(null);
  const [versionsReload, setVersionsReload] = useState(0);
  const [mapKey, setMapKey] = useState<string | null>(null);
  const branchParam = useSearchParams().get("branch");
  const edKey = branchParam ?? "main";
  const editor = edState.key === edKey ? edState.ed : null;
  const snapshot = useSnapshot(page, editor);
  const bumpVersions = useCallback(() => setVersionsReload((k) => k + 1), []);
  const br = useBranching(page, editor, bumpVersions);
  const mountedKey = br.branch?.id ?? "main"; // what the mounted editor actually shows
  const onEditor = useCallback((ed: BlockNoteEditor | null) => {
    // An unmounting editor reports null; only clear if it's still the one we hold.
    setEdState((prev) => (ed ? { ed, key: mountedKey } : prev.key === mountedKey ? { ed: null, key: mountedKey } : prev));
  }, [mountedKey]);
  const inBranch = !!br.branchId;
  const tidy = useTidy(editor, pageId, page?.title ?? "", (label) => {
    // On a branch, the branch's commits are the history; don't touch main.
    if (!inBranch) void snapshot("tidy", label).then(bumpVersions);
  });
  const { attach: tidyAttach, setOpen: setTidyOpen, setAttachment: setTidyAttachment } = tidy;
  const aiEditable = !!page && canEdit && !page.archived_at && page.kind !== "database" && (!inBranch || br.branchEditable);

  // Offer this page's AI actions to the floating AI button.
  useEffect(() => {
    if (!page || page.kind === "database") return;
    aiHub.set({
      pageId,
      canEdit: aiEditable,
      openTidy: () => { setTidyAttachment(null); setTidyOpen(true); },
      hasSelection: () => !!editor?.getSelection()?.blocks?.length,
      attachSelection: () => {
        const a = editor ? selectionToAttachment(editor) : null;
        if (!a) return false;
        tidyAttach(a);
        return true;
      },
    });
    return () => aiHub.set(null);
  }, [pageId, page?.kind, aiEditable, editor, tidyAttach, setTidyOpen, setTidyAttachment]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load page
  useEffect(() => {
    let alive = true;
    setPage(null);
    setParentDb(null);
    setNotFound(false);
    (async () => {
      const { data } = await sb.from("pages").select("*").eq("id", pageId).maybeSingle();
      if (!alive) return;
      if (!data) return setNotFound(true);
      setPage(data as Page);
      if (data.kind === "row" && data.parent_id) {
        const { data: db } = await sb.from("pages").select("*").eq("id", data.parent_id).single();
        if (alive) setParentDb(db as Page);
      }
    })();
    setCurrentPage(pageId);
    return () => { alive = false; setCurrentPage(null); };
  }, [sb, pageId, setCurrentPage]);

  // Realtime updates for metadata (content syncs via Yjs)
  useEffect(() => {
    const ch = sb
      .channel(`page:${pageId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pages", filter: `id=eq.${pageId}` }, (p) => {
        const n = p.new as Page;
        setPage((prev) => prev && ({
          ...prev,
          title: n.updated_by === me.id ? prev.title : n.title,
          icon: n.icon, cover: n.cover, db_schema: n.db_schema, properties: n.properties,
          archived_at: n.archived_at, parent_id: n.parent_id, updated_at: n.updated_at, updated_by: n.updated_by,
        }));
      })
      .subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [sb, pageId, me.id]);

  const patch = useCallback(async (fields: Partial<Page>) => {
    setPage((prev) => (prev ? { ...prev, ...fields } : prev));
    if ("title" in fields || "icon" in fields) upsertPageLocal({ id: pageId, ...(fields as Partial<PageMeta>) });
    const { error } = await sb.from("pages").update(fields).eq("id", pageId);
    if (error) console.error(error);
  }, [sb, pageId, upsertPageLocal]);

  // Debounced title save
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTitle = (title: string) => {
    setPage((prev) => (prev ? { ...prev, title } : prev));
    upsertPageLocal({ id: pageId, title });
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      // Supabase builders are lazy: the request only runs when awaited.
      const { error } = await sb.from("pages").update({ title }).eq("id", pageId);
      if (error) console.error("title save failed", error);
    }, 400);
  };

  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
        <div className="text-4xl">🔍</div>
        페이지를 찾을 수 없거나 접근 권한이 없습니다.
        <Link href={`/w/${workspace.id}`} className="text-accent underline">홈으로</Link>
      </div>
    );
  }
  if (!page) return <Spinner />;

  // Breadcrumbs
  const crumbs: { id: string; title: string; icon: string | null }[] = [];
  let cur = page.parent_id ? pageMap.get(page.parent_id) : undefined;
  while (cur) {
    crumbs.unshift({ id: cur.id, title: cur.title, icon: cur.icon });
    cur = cur.parent_id ? pageMap.get(cur.parent_id) : undefined;
  }
  const viewers = online.filter((u) => u.page_id === pageId);
  const childPages = pages.filter((p) => p.parent_id === pageId);
  const mainEditable = canEdit && !page.archived_at;
  const editable = inBranch ? mainEditable && br.branchEditable : mainEditable;

  const loadVersion = async (c: Commit) => {
    const { data } = await sb.from("page_versions").select("content").eq("id", c.id).single();
    return { ...c, content: (data?.content as unknown[]) ?? [] } as PageVersion;
  };
  const restoreVersion = async (v: PageVersion) => {
    if (!editor) return;
    if (inBranch) {
      if (!confirm("이 버전 내용을 지금 브랜치에 불러올까요? 커밋하기 전까지는 브랜치 작업본만 바뀌어요.")) return;
    } else {
      if (!confirm("이 버전으로 메인을 복원할까요? 지금 문서는 버전으로 남아서 다시 되돌릴 수 있어요.")) return;
      await snapshot("restore", null);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.replaceBlocks(editor.document, v.content as any);
    if (!inBranch && v.title !== page.title) await patch({ title: v.title });
    setPreviewVersion(null);
    bumpVersions();
  };
  const lastEditor = page.updated_by ? memberMap.get(page.updated_by) : undefined;

  const schemaForRow: DbSchema | null = parentDb?.db_schema ?? null;
  const addRowOption = async (propId: string, opt: PropOption) => {
    if (!parentDb?.db_schema) return;
    const next: DbSchema = {
      ...parentDb.db_schema,
      properties: parentDb.db_schema.properties.map((p) => (p.id === propId ? { ...p, options: [...(p.options ?? []), opt] } : p)),
    };
    setParentDb({ ...parentDb, db_schema: next });
    await sb.from("pages").update({ db_schema: next }).eq("id", parentDb.id);
  };
  const setRowProp = async (key: string, value: PropValue) => {
    setPage((prev) => (prev ? { ...prev, properties: { ...prev.properties, [key]: value } } : prev));
    await sb.rpc("set_row_property", { p_page: pageId, p_key: key, p_value: value });
  };

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-11 shrink-0 items-center gap-1 pl-11 pr-2 text-sm md:gap-2 md:px-3">
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 text-muted">
            {crumbs.map((c) => (
              <span key={c.id} className="hidden min-w-0 items-center gap-0.5 md:flex">
                <Link href={`/w/${workspace.id}/p/${c.id}`} className="truncate rounded px-1.5 py-0.5 hover:bg-hover">
                  {c.icon} {c.title || "제목 없음"}
                </Link>
                <ChevronRight size={12} className="shrink-0" />
              </span>
            ))}
            {parentDb && (
              <span className="hidden min-w-0 items-center gap-0.5 md:flex">
                <Link href={`/w/${workspace.id}/p/${parentDb.id}`} className="truncate rounded px-1.5 py-0.5 hover:bg-hover">
                  {parentDb.icon} {parentDb.title}
                </Link>
                <ChevronRight size={12} className="shrink-0" />
              </span>
            )}
            <span className="truncate px-1.5 text-foreground">{page.icon} {page.title || "제목 없음"}</span>
          </nav>
          {saveState && editable && page.kind !== "database" && (
            <span className="text-xs text-muted">{saveState === "saving" ? "저장 중…" : saveState === "saved" ? "저장됨" : "저장 실패"}</span>
          )}
          {lastEditor && (
            <span className="hidden text-xs text-muted md:inline" title={new Date(page.updated_at).toLocaleString("ko-KR")}>
              {lastEditor.display_name}님이 편집
            </span>
          )}
          <div className="flex -space-x-1.5">
            {viewers.map((v) => (
              <Avatar key={v.user_id} ring size={24} profile={{ display_name: v.name, avatar_color: v.color, email: "" }} />
            ))}
          </div>
          <button title="댓글" onClick={() => setShowComments((v) => !v)} className={`rounded p-1.5 hover:bg-hover ${showComments ? "bg-hover" : ""}`}>
            <MessageSquare size={16} />
          </button>
          <button title="즐겨찾기" onClick={() => toggleFavorite(pageId)} className="rounded p-1.5 hover:bg-hover">
            <Star size={16} className={favorites.has(pageId) ? "fill-yellow-400 text-yellow-400" : ""} />
          </button>
          <div className="relative">
            <button onClick={() => setMenu(true)} className="rounded p-1.5 hover:bg-hover"><MoreHorizontal size={16} /></button>
            <Popover open={menu} onClose={() => setMenu(false)} align="right">
              <MenuItem onClick={() => { void navigator.clipboard.writeText(window.location.href); setMenu(false); }}>
                <Link2 size={14} /> 링크 복사
              </MenuItem>
              {page.kind !== "database" && (
                <MenuItem onClick={() => { setMenu(false); setShowComments(false); setShowVersions(true); }}>
                  <History size={14} /> 버전 맵
                </MenuItem>
              )}
              {canEdit && page.kind === "doc" && (
                <MenuItem onClick={() => { setMenu(false); ws.ui.setTemplatesOpen({ parentId: pageId }); }}>
                  <LayoutTemplate size={14} /> 하위에 템플릿 추가
                </MenuItem>
              )}
              {canEdit && !page.archived_at && (
                <MenuItem danger onClick={async () => {
                  setMenu(false);
                  await setArchived(sb, pageId, true);
                  upsertPageLocal({ id: pageId, archived_at: new Date().toISOString() });
                  router.push(parentDb ? `/w/${workspace.id}/p/${parentDb.id}` : `/w/${workspace.id}`);
                }}>
                  <Trash2 size={14} /> 휴지통으로 이동
                </MenuItem>
              )}
            </Popover>
          </div>
        </header>

        {page.archived_at && (
          <div className="flex items-center justify-center gap-3 bg-red-500 px-4 py-2 text-sm text-white">
            이 페이지는 휴지통에 있습니다.
            {canEdit && (
              <>
                <button className="flex items-center gap-1 rounded border border-white/60 px-2 py-0.5 hover:bg-white/10" onClick={async () => {
                  await setArchived(sb, pageId, false);
                  setPage({ ...page, archived_at: null });
                }}><RotateCcw size={12} /> 복원</button>
                <button className="rounded border border-white/60 px-2 py-0.5 hover:bg-white/10" onClick={async () => {
                  if (!confirm("영구 삭제할까요?")) return;
                  await deleteForever(sb, pageId);
                  router.push(`/w/${workspace.id}`);
                }}>영구 삭제</button>
              </>
            )}
          </div>
        )}

        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {/* Cover */}
          {page.cover && (
            <div className="group relative h-32 w-full md:h-48" style={{ background: page.cover }}>
              {editable && (
                <div className="absolute bottom-2 right-4 flex gap-1 touch-show opacity-0 group-hover:opacity-100">
                  <button onClick={() => patch({ cover: COVERS[(COVERS.indexOf(page.cover!) + 1) % COVERS.length] })}
                    className="rounded bg-background/80 px-2 py-1 text-xs hover:bg-background">커버 변경</button>
                  <button onClick={() => patch({ cover: null })} className="rounded bg-background/80 px-2 py-1 text-xs hover:bg-background">제거</button>
                </div>
              )}
            </div>
          )}

          <div className={`mx-auto px-4 md:px-12 ${page.kind === "database" || tidy.reviewing ? "max-w-6xl" : "max-w-3xl"}`}>
            {/* Icon */}
            <div className={`group relative ${page.cover ? "-mt-8 md:-mt-10" : "pt-6 md:pt-16"}`}>
              {page.icon && (
                <button disabled={!editable} onClick={() => setIconPicker(true)} className="rounded-lg text-6xl leading-none hover:bg-hover md:text-7xl">
                  {page.icon}
                </button>
              )}
              <div className={`flex gap-1 pt-2 text-sm text-muted touch-show opacity-0 transition group-hover:opacity-100 ${editable ? "" : "hidden"}`}>
                {!page.icon && (
                  <button onClick={() => setIconPicker(true)} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-hover"><Smile size={14} /> 아이콘 추가</button>
                )}
                {!page.cover && (
                  <button onClick={() => patch({ cover: COVERS[Math.floor(Math.random() * COVERS.length)] })} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-hover"><ImageIcon size={14} /> 커버 추가</button>
                )}
              </div>
              <Popover open={iconPicker} onClose={() => setIconPicker(false)}>
                <EmojiPicker
                  onPick={(e) => { void patch({ icon: e }); setIconPicker(false); }}
                  onRemove={page.icon ? () => { void patch({ icon: null }); setIconPicker(false); } : undefined}
                />
              </Popover>
            </div>

            {inBranch && (
              <BranchBanner b={br} ownerName={br.branch ? memberMap.get(br.branch.owner_id)?.display_name ?? "?" : ""} />
            )}

            {/* Title */}
            <TitleArea value={inBranch ? br.branch?.title ?? page.title : page.title} editable={editable && !inBranch} onChange={onTitle} />

            {/* Row properties */}
            {page.kind === "row" && schemaForRow && (
              <div className="mb-4 space-y-0.5 border-b border-line pb-4">
                {schemaForRow.properties.map((p) => (
                  <div key={p.id} className="flex items-start text-sm">
                    <div className="w-28 shrink-0 truncate px-2 py-1.5 text-muted md:w-40">{p.name}</div>
                    <div className="min-w-0 flex-1">
                      <PropertyCell prop={p} value={page.properties[p.id]} members={ws.members} canEdit={editable}
                        onAddOption={addRowOption} onChange={(v) => setRowProp(p.id, v)} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {page.kind === "database" ? (
              page.db_schema ? (
                <DatabaseView
                  pageId={pageId}
                  schema={page.db_schema}
                  onSchemaChange={(s) => void patch({ db_schema: s })}
                />
              ) : null
            ) : (
              <>
                {/* Editor stays mounted while reviewing so Apply can write through it. */}
                <div className={tidy.reviewing || previewVersion ? "hidden" : ""}>
                {inBranch && !br.branch ? <Spinner /> : (
                <CollaborativeEditor
                  key={br.branch?.id ?? "main"}
                  sb={sb}
                  pageId={pageId}
                  branchId={br.branch?.id}
                  workspaceId={workspace.id}
                  initialYdoc={br.branch ? br.branch.ydoc : page.ydoc}
                  initialContent={br.branch ? br.branch.content : page.content}
                  me={me}
                  editable={editable}
                  onSaveState={setSaveState}
                  onEditor={onEditor}
                  onAskAI={tidy.attach}
                />
                )}
                {page.kind === "doc" && !inBranch && (
                  <SubPages pageId={pageId} childPages={childPages} canEdit={editable} />
                )}
                </div>
                {tidy.reviewing && <TidyReview tidy={tidy} />}
                {previewVersion && !tidy.reviewing && (
                  <VersionPreview
                    version={previewVersion}
                    editor={editor}
                    currentTitle={page.title}
                    canEdit={editable}
                    onClose={() => setPreviewVersion(null)}
                    onRestore={() => restoreVersion(previewVersion)}
                  />
                )}
              </>
            )}
          </div>
        </div>
        {editable && page.kind !== "database" && <TidyBar tidy={tidy} />}
      </div>
      {showComments && <CommentsPanel pageId={pageId} onClose={() => setShowComments(false)} />}
      {showVersions && !showComments && (
        <VersionMap
          pageId={pageId}
          canEdit={mainEditable}
          currentBranchId={br.branchId}
          reloadKey={versionsReload}
          selectedKey={mapKey}
          onSelect={(s) => setMapKey(s ? (s.kind === "commit" ? s.commit.id : `head:${s.branch?.id ?? "main"}`) : null)}
          onPreview={async (c) => {
            setPreviewVersion(await loadVersion(c));
            // Phones: the map covers the screen, so close it to show the comparison.
            if (window.matchMedia("(max-width: 767px)").matches) setShowVersions(false);
          }}
          onFork={(from) => { setPreviewVersion(null); void br.fork(from); }}
          onRestore={async (c) => { await restoreVersion(await loadVersion(c)); }}
          onOpenBranch={(b) => { setPreviewVersion(null); br.openBranch(b); }}
          onMerge={(b) => { setPreviewVersion(null); void br.merge(b); }}
          onCloseBranch={(b) => void br.closeBranch(b)}
          onSaveNow={async () => {
            const name = prompt("버전 이름 (비워 두면 이름 없이 저장)", "");
            if (name === null) return;
            await snapshot("manual", name.trim() || null);
            bumpVersions();
          }}
          onClose={() => { setShowVersions(false); setPreviewVersion(null); setMapKey(null); }}
        />
      )}
    </div>
  );
}

function TitleArea({ value, editable, onChange }: { value: string; editable: boolean; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      readOnly={!editable}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ""))}
      placeholder="제목 없음"
      className="page-title mb-2 mt-3 w-full resize-none overflow-hidden bg-transparent text-3xl font-bold leading-tight outline-none md:text-4xl placeholder:text-foreground/20"
    />
  );
}

function SubPages({ pageId, childPages, canEdit }: { pageId: string; childPages: PageMeta[]; canEdit: boolean }) {
  const { sb, me, workspace, upsertPageLocal, ui } = useWorkspace();
  const router = useRouter();
  if (!childPages.length && !canEdit) return null;
  return (
    <div className="mb-24 border-t border-line pt-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
        하위 페이지
        {canEdit && (
          <>
            <button className="flex items-center gap-1 rounded px-1.5 py-0.5 font-normal hover:bg-hover" onClick={async () => {
              const p = await createPage(sb, { workspaceId: workspace.id, userId: me.id, parentId: pageId });
              upsertPageLocal(p);
              router.push(`/w/${workspace.id}/p/${p.id}`);
            }}><Plus size={12} /> 페이지</button>
            <button className="flex items-center gap-1 rounded px-1.5 py-0.5 font-normal hover:bg-hover" onClick={() => ui.setTemplatesOpen({ parentId: pageId })}>
              <LayoutTemplate size={12} /> 템플릿
            </button>
          </>
        )}
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        {childPages.map((c) => (
          <Link key={c.id} href={`/w/${workspace.id}/p/${c.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
            {c.icon ?? (c.kind === "database" ? <Table2 size={16} className="text-muted" /> : <FileText size={16} className="text-muted" />)}
            <span className="truncate underline decoration-line underline-offset-4">{c.title || "제목 없음"}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
