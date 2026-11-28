"use client";

import { blocksToMd } from "@/lib/blocks/md";
import { useCallback, useEffect, useMemo, useState } from "react";
import { History, RotateCcw, Save, X } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { Avatar } from "./ui";
import { CompareDocs } from "./tidy";
import type { BlockNoteEditor } from "./editor";
import type { Page } from "@/lib/types";

export interface PageVersion {
  id: string;
  title: string;
  content: unknown[];
  source: "auto" | "manual" | "tidy" | "mcp" | "restore" | "commit" | "merge" | "fork";
  label: string | null;
  edited_by: string | null;
  edited_at: string;
  saved_by: string | null;
  created_at: string;
}

const SOURCE_LABEL: Record<PageVersion["source"], string> = {
  auto: "자동 저장",
  manual: "직접 저장",
  tidy: "AI 정리 전",
  mcp: "Claude 수정 전",
  restore: "복원 전",
  commit: "커밋",
  merge: "머지",
  fork: "브랜치 시작점",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
const full = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Saves a snapshot of the page as it is in the editor right now. */
export function useSnapshot(page: Page | null, editor: BlockNoteEditor | null) {
  const { sb, me } = useWorkspace();
  return useCallback(
    async (source: PageVersion["source"], label: string | null) => {
      if (!page || !editor) return;
      const { error } = await sb.from("page_versions").insert({
        page_id: page.id,
        workspace_id: page.workspace_id,
        title: page.title,
        content: editor.document,
        source,
        label,
        edited_by: page.updated_by,
        edited_at: page.updated_at,
        saved_by: me.id,
      });
      if (error) console.error("version save failed", error);
    },
    [sb, me.id, page, editor],
  );
}

/** Side panel listing a page's versions. */
export function VersionsPanel({
  pageId, canEdit, selectedId, onSelect, onSaveNow, onClose, reloadKey,
}: {
  pageId: string;
  canEdit: boolean;
  selectedId: string | null;
  onSelect: (v: PageVersion) => void;
  onSaveNow: () => Promise<void>;
  onClose: () => void;
  reloadKey: number;
}) {
  const { sb, memberMap } = useWorkspace();
  const [versions, setVersions] = useState<PageVersion[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void sb
      .from("page_versions")
      .select("id, title, content, source, label, edited_by, edited_at, saved_by, created_at")
      .eq("page_id", pageId)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => { if (alive) setVersions((data ?? []) as PageVersion[]); });
    return () => { alive = false; };
  }, [sb, pageId, reloadKey]);

  const groups = useMemo(() => {
    const m = new Map<string, PageVersion[]>();
    for (const v of versions ?? []) m.set(day(v.created_at), [...(m.get(day(v.created_at)) ?? []), v]);
    return [...m.entries()];
  }, [versions]);

  return (
    <aside className="fixed inset-0 z-[85] flex flex-col bg-background md:static md:z-auto md:h-full md:w-80 md:shrink-0 md:border-l md:border-line">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2 font-semibold"><History size={16} /> 버전 기록</span>
        <button onClick={onClose} className="rounded p-1 hover:bg-hover"><X size={16} /></button>
      </div>
      {canEdit && (
        <div className="border-b border-line p-3">
          <button
            disabled={saving}
            onClick={async () => { setSaving(true); await onSaveNow(); setSaving(false); }}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-line py-1.5 text-sm hover:bg-hover disabled:opacity-60"
          >
            <Save size={14} /> 현재 버전 저장
          </button>
          <p className="mt-1.5 text-xs text-muted">편집을 다시 시작할 때(10분 이상 쉬었다가), AI 정리·Claude 수정·복원 직전에는 자동으로 저장돼요.</p>
        </div>
      )}
      <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
        {versions === null && <p className="p-4 text-center text-sm text-muted">불러오는 중…</p>}
        {versions?.length === 0 && <p className="p-6 text-center text-sm text-muted">아직 저장된 버전이 없어요. 문서를 고치면 자동으로 쌓입니다.</p>}
        {groups.map(([d, list]) => (
          <div key={d} className="mb-3">
            <div className="px-2 py-1 text-xs font-semibold text-muted">{d}</div>
            {list.map((v) => {
              const who = v.edited_by ? memberMap.get(v.edited_by) : undefined;
              return (
                <button
                  key={v.id}
                  onClick={() => onSelect(v)}
                  className={`flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-hover ${selectedId === v.id ? "bg-hover" : ""}`}
                >
                  <Avatar profile={who} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm">
                      <span className="font-medium tabular-nums">{time(v.created_at)}</span>
                      <span className="text-xs text-muted">{SOURCE_LABEL[v.source]}</span>
                    </span>
                    {v.label && <span className="block truncate text-sm">{v.label}</span>}
                    <span className="block truncate text-xs text-muted">
                      {who?.display_name ?? "알 수 없음"} 편집 · {v.title || "제목 없음"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}

/** Replaces the editor while previewing a version: compares it with the current page. */
export function VersionPreview({
  version, editor, currentTitle, canEdit, onRestore, onClose,
}: {
  version: PageVersion;
  editor: BlockNoteEditor | null;
  currentTitle: string;
  canEdit: boolean;
  onRestore: () => Promise<void>;
  onClose: () => void;
}) {
  const { memberMap } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const who = version.edited_by ? memberMap.get(version.edited_by) : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oldMd = useMemo(() => (editor ? blocksToMd(editor, version.content as any) : ""), [editor, version]);
  const curMd = editor ? blocksToMd(editor, editor.document) : "";

  return (
    <div className="pb-24">
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-line bg-background px-4 py-2 md:-mx-12 md:px-12">
        <History size={16} className="hidden text-muted sm:block" />
        <div className="min-w-0 basis-full text-sm sm:flex-1 sm:basis-auto">
          <span className="font-medium">{full(version.created_at)} 버전</span>
          <span className="ml-2 text-muted">{SOURCE_LABEL[version.source]}{version.label ? ` · ${version.label}` : ""} · {who?.display_name ?? "알 수 없음"} 편집</span>
        </div>
        {canEdit && (
          <button
            disabled={busy || !editor}
            onClick={async () => { setBusy(true); await onRestore(); setBusy(false); }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 sm:flex-none"
          >
            <RotateCcw size={14} /> 이 버전으로 복원
          </button>
        )}
        <button onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-hover">닫기</button>
      </div>
      {version.title !== currentTitle && (
        <p className="mb-3 text-sm text-muted">제목: <del>{version.title || "제목 없음"}</del> → {currentTitle || "제목 없음"}</p>
      )}
      <CompareDocs
        original={oldMd}
        revised={curMd}
        labels={["이 버전", "현재"]}
        icon="🕘"
        summary="이 버전과 지금 문서의 차이예요. 복원하면 지금 문서도 버전으로 남아서 다시 되돌릴 수 있어요."
        nothingText="지금 문서와 내용이 같아요."
      />
    </div>
  );
}
