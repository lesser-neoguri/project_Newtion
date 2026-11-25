"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GitBranch, GitCommitVertical, GitMerge, Undo2 } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import type { BlockNoteEditor } from "./editor";
import type { Branch, Commit } from "./version-map";
import type { PageVersion } from "./versions";
import type { Page } from "@/lib/types";

export interface BranchFull extends Branch {
  title: string;
  content: unknown[];
  ydoc: string | null;
}

/** Key-order-independent JSON (jsonb doesn't keep key order). */
const normalize = (v: unknown): string => {
  const sort = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sort)
      : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]))
        : x;
  return JSON.stringify(sort(v ?? []));
};

/**
 * Branch workflow for a page:
 * - `?branch=<id>` opens a branch's own working copy in the editor
 * - commits on a branch, forks from any version, merges into main
 *   (`?merge=<id>` runs on the main editor so the change goes out live)
 */
export function useBranching(page: Page | null, editor: BlockNoteEditor | null, onChanged: () => void) {
  const { sb, me, workspace } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const branchId = params.get("branch");
  const mergeId = params.get("merge");
  const [branch, setBranch] = useState<BranchFull | null>(null);
  const merging = useRef(false);

  // Load the open branch.
  useEffect(() => {
    if (!branchId) { setBranch(null); return; }
    let alive = true;
    void sb.from("page_branches").select("*").eq("id", branchId).maybeSingle().then(({ data }) => {
      if (alive) setBranch((data as BranchFull) ?? null);
    });
    return () => { alive = false; };
  }, [sb, branchId]);

  const latestCommit = useCallback(async (bid: string | null) => {
    let q = sb.from("page_versions").select("id, content").eq("page_id", page!.id).order("created_at", { ascending: false }).limit(1);
    q = bid ? q.eq("branch_id", bid) : q.is("branch_id", null);
    const { data } = await q;
    return (data?.[0] as { id: string; content: unknown[] } | undefined) ?? null;
  }, [sb, page]);

  const insertCommit = useCallback(async (fields: {
    branch_id: string | null; parent_id?: string | null; merge_parent_id?: string | null;
    source: PageVersion["source"]; label: string | null; content: unknown[]; title?: string;
  }) => {
    const { data, error } = await sb.from("page_versions").insert({
      page_id: page!.id,
      workspace_id: workspace.id,
      title: fields.title ?? page!.title,
      content: fields.content,
      source: fields.source,
      label: fields.label,
      branch_id: fields.branch_id,
      parent_id: fields.parent_id ?? null,
      merge_parent_id: fields.merge_parent_id ?? null,
      edited_by: me.id,
      edited_at: new Date().toISOString(),
      saved_by: me.id,
    }).select("id").single();
    if (error) throw error;
    return data.id as string;
  }, [sb, page, workspace.id, me.id]);

  const goMain = useCallback(() => router.push(pathname), [router, pathname]);
  const openBranch = useCallback((b: Branch | null) => router.push(b ? `${pathname}?branch=${b.id}` : pathname), [router, pathname]);

  /** Commit the open branch's working copy. */
  const commit = useCallback(async (message?: string) => {
    if (!branch || !editor) return null;
    const msg = message ?? prompt("커밋 메시지", "");
    if (msg === null) return null;
    const head = await latestCommit(branch.id);
    if (head && normalize(head.content) === normalize(editor.document) && !message) {
      alert("마지막 커밋 이후 바뀐 내용이 없어요.");
      return head.id;
    }
    const id = await insertCommit({
      branch_id: branch.id, parent_id: head?.id ?? branch.base_version_id, source: "commit",
      label: msg.trim() || "커밋", content: editor.document,
    });
    onChanged();
    return id;
  }, [branch, editor, latestCommit, insertCommit, onChanged]);

  /** Start a branch of mine from a version (or from the current main document). */
  const fork = useCallback(async (from: Commit | null) => {
    if (!page) return;
    const { count } = await sb.from("page_branches").select("id", { count: "exact", head: true }).eq("page_id", page.id).eq("owner_id", me.id);
    const name = prompt("새 브랜치 이름", `${me.display_name}의 아이디어 ${(count ?? 0) + 1}`);
    if (name === null || !name.trim()) return;
    let baseId: string;
    let content: unknown[];
    let title = page.title;
    if (from) {
      const { data } = await sb.from("page_versions").select("content, title").eq("id", from.id).single();
      baseId = from.id;
      content = (data?.content as unknown[]) ?? [];
      title = data?.title ?? title;
    } else {
      // From the live main document: record its current state as the fork point.
      if (branchId) {
        const { data } = await sb.from("pages").select("content").eq("id", page.id).single();
        content = (data?.content as unknown[]) ?? [];
      } else content = editor?.document ?? page.content;
      baseId = await insertCommit({ branch_id: null, source: "fork", label: "브랜치 시작점", content });
    }
    const { data: b, error } = await sb.from("page_branches").insert({
      page_id: page.id, workspace_id: workspace.id, name: name.trim().slice(0, 60), owner_id: me.id,
      base_version_id: baseId, title, content,
    }).select("id").single();
    if (error) return alert(error.message);
    onChanged();
    router.push(`${pathname}?branch=${b.id}`);
  }, [page, sb, me, branchId, editor, insertCommit, workspace.id, onChanged, router, pathname]);

  /** Merge a branch into main: make sure its latest state is committed, then apply it on the main editor. */
  const merge = useCallback(async (b: Branch) => {
    if (branchId === b.id && editor) {
      const head = await latestCommit(b.id);
      if (!head || normalize(head.content) !== normalize(editor.document)) await commit("머지 전 커밋");
    }
    router.push(`${pathname}?merge=${b.id}`);
  }, [branchId, editor, latestCommit, commit, router, pathname]);

  // Runs on the main editor when opened with ?merge=<id>.
  useEffect(() => {
    if (!mergeId || branchId || !editor || !page || merging.current) return;
    merging.current = true;
    (async () => {
      try {
        const { data: b } = await sb.from("page_branches").select("*").eq("id", mergeId).single();
        if (!b || b.status !== "open") return;
        if (!confirm(`'${b.name}' 브랜치를 메인에 합칠까요?\n메인 문서가 이 브랜치 내용으로 바뀌고, 지금 메인 상태는 '머지 전 메인' 버전으로 남아요.`)) return;
        let head = await latestCommit(b.id);
        if (!head || normalize(head.content) !== normalize(b.content)) {
          const id = await insertCommit({ branch_id: b.id, parent_id: head?.id ?? b.base_version_id, source: "commit", label: "머지 전 커밋", content: b.content });
          head = { id, content: b.content };
        }
        const mainHead = await latestCommit(null);
        if (!mainHead || normalize(mainHead.content) !== normalize(editor.document)) {
          await insertCommit({ branch_id: null, source: "auto", label: "머지 전 메인", content: editor.document });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.replaceBlocks(editor.document, b.content as any);
        const mergeVersion = await insertCommit({
          branch_id: null, merge_parent_id: head.id, source: "merge", label: `머지: ${b.name}`, content: b.content,
        });
        await sb.from("page_branches").update({ status: "merged", merged_version_id: mergeVersion }).eq("id", b.id);
        onChanged();
      } finally {
        merging.current = false;
        router.replace(pathname);
      }
    })();
  }, [mergeId, branchId, editor, page, sb, latestCommit, insertCommit, onChanged, router, pathname]);

  const closeBranch = useCallback(async (b: Branch) => {
    if (!confirm(`'${b.name}' 브랜치를 닫을까요? 커밋 기록은 버전 맵에 남아요.`)) return;
    await sb.from("page_branches").update({ status: "closed" }).eq("id", b.id);
    onChanged();
    if (branchId === b.id) goMain();
  }, [sb, branchId, goMain, onChanged]);

  return {
    branchId, branch, mergePending: !!mergeId,
    branchEditable: !!branch && branch.owner_id === me.id && branch.status === "open",
    commit, fork, merge, closeBranch, openBranch, goMain,
  };
}

export type Branching = ReturnType<typeof useBranching>;

/** Banner shown above the title while a branch is open. */
export function BranchBanner({ b, ownerName }: { b: Branching; ownerName: string }) {
  const br = b.branch;
  if (!br) return null;
  const btn = "flex items-center gap-1 rounded-md border border-line bg-background px-2.5 py-1 text-xs hover:bg-hover";
  return (
    <div className="sticky top-0 z-20 -mx-4 mb-2 flex flex-wrap items-center gap-2 border-b border-line bg-[color-mix(in_srgb,var(--accent)_8%,var(--background))] px-4 py-2 text-sm md:-mx-12 md:px-12">
      <GitBranch size={15} className="text-accent" />
      <span className="min-w-0 flex-1">
        <b className="font-semibold">{ownerName} / {br.name}</b>
        <span className="ml-2 text-muted">
          {br.status === "open" ? (b.branchEditable ? "내 브랜치 · 메인과 분리돼 있어요" : "읽기 전용 · 다른 사람의 브랜치") : br.status === "merged" ? "메인에 합쳐진 브랜치" : "닫힌 브랜치"}
        </span>
      </span>
      {b.branchEditable && (
        <>
          <button className={btn} onClick={() => void b.commit()}><GitCommitVertical size={13} /> 커밋</button>
          <button className={btn} onClick={() => void b.merge(br)}><GitMerge size={13} /> 메인에 합치기</button>
        </>
      )}
      <button className={btn} onClick={b.goMain}><Undo2 size={13} /> 메인으로</button>
    </div>
  );
}
