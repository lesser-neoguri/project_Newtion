"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, GitBranch, GitMerge, GitCommitVertical, RotateCcw, Send, Trash2, X } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { Avatar } from "./ui";
import type { PageVersion } from "./versions";

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

export interface Commit extends Omit<PageVersion, "content"> {
  branch_id: string | null;
  parent_id: string | null;
  merge_parent_id: string | null;
  actor: "user" | "ai";
  actor_name: string | null;
}

export interface Branch {
  id: string;
  page_id: string;
  name: string;
  owner_id: string;
  base_version_id: string | null;
  status: "open" | "merged" | "closed";
  merged_version_id: string | null;
  created_at: string;
  updated_at: string;
}

interface VComment { id: string; version_id: string; user_id: string; body: string; created_at: string }

const COMMIT_COLS = "id, title, source, label, edited_by, edited_at, saved_by, created_at, branch_id, parent_id, merge_parent_id, actor, actor_name";

/** Loads commits, branches and comment counts for a page, live. */
export function useVersionGraph(pageId: string, reloadKey: number) {
  const { sb } = useWorkspace();
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: c }, { data: b }] = await Promise.all([
        sb.from("page_versions").select(COMMIT_COLS).eq("page_id", pageId).order("created_at", { ascending: false }).limit(300),
        sb.from("page_branches").select("id, page_id, name, owner_id, base_version_id, status, merged_version_id, created_at, updated_at").eq("page_id", pageId).order("created_at"),
      ]);
      const list = (c ?? []) as Commit[];
      const ids = list.map((x) => x.id);
      const { data: vc } = ids.length
        ? await sb.from("version_comments").select("version_id").in("version_id", ids)
        : { data: [] as { version_id: string }[] };
      if (!alive) return;
      const n: Record<string, number> = {};
      for (const r of vc ?? []) n[r.version_id] = (n[r.version_id] ?? 0) + 1;
      setCommits(list);
      setBranches((b ?? []) as Branch[]);
      setCounts(n);
    })();
    return () => { alive = false; };
  }, [sb, pageId, reloadKey, tick]);

  // Live: reload when commits, branches or comments change.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(t); t = setTimeout(() => setTick((k) => k + 1), 400); };
    const ch = sb
      .channel(`vmap:${pageId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "page_versions", filter: `page_id=eq.${pageId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "page_branches", filter: `page_id=eq.${pageId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "version_comments" }, bump)
      .subscribe();
    return () => { clearTimeout(t); void sb.removeChannel(ch); };
  }, [sb, pageId]);

  return { commits, branches, counts };
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

const LANE_W = 22;
const ROW_H = 46;
const PAD_X = 14;
const PAD_Y = 24;
const MAIN_COLOR = "#64748b";
const USER_HUES = [217, 152, 280, 24, 330, 190, 45, 0];

interface Lane { key: string; branch: Branch | null; ownerId: string | null; color: string }

type Row =
  | { kind: "head"; key: string; lane: number; branch: Branch | null }
  | { kind: "commit"; key: string; lane: number; commit: Commit };

function buildLayout(commits: Commit[], branches: Branch[], memberOrder: string[]) {
  // Lanes: main, then each user's branches (users in member order, branches by creation).
  const owners = [...new Set(branches.map((b) => b.owner_id))].sort(
    (a, b) => (memberOrder.indexOf(a) + 1 || 999) - (memberOrder.indexOf(b) + 1 || 999),
  );
  const lanes: Lane[] = [{ key: "main", branch: null, ownerId: null, color: MAIN_COLOR }];
  owners.forEach((owner, oi) => {
    const mine = branches.filter((b) => b.owner_id === owner);
    mine.forEach((b, bi) => {
      const light = 46 + (bi % 3) * 10;
      lanes.push({ key: b.id, branch: b, ownerId: owner, color: `hsl(${USER_HUES[oi % USER_HUES.length]} 70% ${light}%)` });
    });
  });
  const laneOf = (branchId: string | null) => Math.max(0, lanes.findIndex((l) => (branchId ? l.key === branchId : l.key === "main")));

  // Rows: one "current" row with the working heads, then commits newest first.
  const rows: Row[] = [{ kind: "head", key: "head:main", lane: 0, branch: null }];
  for (const b of branches.filter((x) => x.status === "open")) rows.push({ kind: "head", key: `head:${b.id}`, lane: laneOf(b.id), branch: b });
  for (const c of commits) rows.push({ kind: "commit", key: c.id, lane: laneOf(c.branch_id), commit: c });

  // All heads share the first visual row.
  const yOf = new Map<string, number>();
  let r = 0;
  rows.forEach((row) => {
    if (row.kind === "head") yOf.set(row.key, PAD_Y);
    else { r++; yOf.set(row.key, PAD_Y + r * ROW_H); }
  });
  const height = PAD_Y * 2 + r * ROW_H;
  const xOf = (lane: number) => PAD_X + lane * LANE_W;

  // Edges
  type Edge = { d: string; color: string; dashed?: boolean };
  const edges: Edge[] = [];
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    if (x1 === x2) return `M${x1},${y1} L${x2},${y2}`;
    const my = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
  };
  const byId = new Map(commits.map((c) => [c.id, c]));

  lanes.forEach((lane, li) => {
    const x = xOf(li);
    const ys = commits
      .filter((c) => (lane.branch ? c.branch_id === lane.branch.id : c.branch_id === null))
      .map((c) => yOf.get(c.id)!);
    const open = !lane.branch || lane.branch.status === "open";
    if (!lane.branch) {
      if (ys.length) edges.push({ d: `M${x},${PAD_Y} L${x},${Math.max(...ys)}`, color: lane.color });
      return;
    }
    const base = lane.branch.base_version_id ? byId.get(lane.branch.base_version_id) : undefined;
    // Where the lane starts at the bottom: just above its fork point (or its oldest commit).
    const forkY = base ? yOf.get(base.id)! - ROW_H * 0.5 : ys.length ? Math.max(...ys) : PAD_Y;
    const topY = open ? PAD_Y : ys.length ? Math.min(...ys) : forkY;
    if (base) edges.push({ d: curve(xOf(laneOf(base.branch_id)), yOf.get(base.id)!, x, forkY), color: lane.color });
    if (topY < forkY) edges.push({ d: `M${x},${forkY} L${x},${topY}`, color: lane.color });
  });
  // Merges: from the merged commit (on its branch lane) into the merge commit.
  for (const c of commits) {
    if (!c.merge_parent_id) continue;
    const from = byId.get(c.merge_parent_id);
    if (!from) continue;
    const fl = laneOf(from.branch_id);
    edges.push({ d: curve(xOf(fl), yOf.get(from.id)!, xOf(laneOf(c.branch_id)), yOf.get(c.id)!), color: lanes[fl]?.color ?? MAIN_COLOR });
  }

  return { lanes, rows, yOf, xOf, height, width: PAD_X * 2 + (lanes.length - 1) * LANE_W, edges };
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

const SOURCE: Record<string, string> = {
  auto: "자동 저장", manual: "저장", tidy: "AI 정리 전", mcp: "AI 커밋", restore: "복원",
  commit: "커밋", merge: "머지", fork: "브랜치 시작점",
};
const time = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

export type MapSelection = { kind: "commit"; commit: Commit } | { kind: "head"; branch: Branch | null };

export function VersionMap({
  pageId, canEdit, currentBranchId, reloadKey, selectedKey,
  onSelect, onPreview, onFork, onRestore, onOpenBranch, onMerge, onCloseBranch, onSaveNow, onClose,
}: {
  pageId: string;
  canEdit: boolean;
  currentBranchId: string | null;
  reloadKey: number;
  selectedKey: string | null;
  onSelect: (s: MapSelection | null) => void;
  onPreview: (c: Commit) => void;
  onFork: (from: Commit | null) => void;
  onRestore: (c: Commit) => void;
  onOpenBranch: (b: Branch | null) => void;
  onMerge: (b: Branch) => void;
  onCloseBranch: (b: Branch) => void;
  onSaveNow: () => void;
  onClose: () => void;
}) {
  const { me, members, memberMap } = useWorkspace();
  const { commits, branches, counts } = useVersionGraph(pageId, reloadKey);
  const memberOrder = useMemo(() => members.map((m) => m.user_id), [members]);
  const layout = useMemo(() => (commits ? buildLayout(commits, branches, memberOrder) : null), [commits, branches, memberOrder]);
  const [sel, setSel] = useState<MapSelection | null>(null);

  // The floating AI button would cover the node card's comment box.
  useEffect(() => {
    document.body.dataset.vmap = "1";
    return () => { delete document.body.dataset.vmap; };
  }, []);

  const select = useCallback((s: MapSelection | null) => { setSel(s); onSelect(s); }, [onSelect]);
  useEffect(() => {
    if (!selectedKey) setSel(null);
  }, [selectedKey]);

  const ownerGroups = useMemo(() => {
    if (!layout) return [];
    const g = new Map<string, Lane[]>();
    for (const l of layout.lanes.slice(1)) g.set(l.ownerId!, [...(g.get(l.ownerId!) ?? []), l]);
    return [...g.entries()];
  }, [layout]);

  return (
    <aside className="fixed inset-0 z-[85] flex flex-col bg-background md:static md:z-auto md:h-full md:w-[420px] md:shrink-0 md:border-l md:border-line">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2 font-semibold"><GitBranch size={16} /> 버전 맵</span>
        <div className="flex items-center gap-1">
          {canEdit && !currentBranchId && (
            <button onClick={onSaveNow} title="지금 상태를 메인에 저장" className="rounded-md border border-line px-2 py-1 text-xs hover:bg-hover">
              지금 저장
            </button>
          )}
          <button onClick={onClose} className="rounded p-1 hover:bg-hover"><X size={16} /></button>
        </div>
      </div>

      {/* Legend: main + each user's branches */}
      {layout && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-xs">
          <span className="flex items-center gap-1"><Dot color={MAIN_COLOR} /> 메인</span>
          {ownerGroups.map(([owner, ls]) => (
            <span key={owner} className="flex items-center gap-1">
              <span className="font-medium">{memberMap.get(owner)?.display_name ?? "?"}</span>
              {ls.map((l) => (
                <span key={l.key} className={`flex items-center gap-0.5 ${l.branch?.status === "closed" ? "text-muted line-through" : l.branch?.status === "merged" ? "text-muted" : ""}`}>
                  <Dot color={l.color} />{l.branch?.name}
                </span>
              ))}
            </span>
          ))}
        </div>
      )}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {!layout && <p className="p-6 text-center text-sm text-muted">불러오는 중…</p>}
        {layout && (
          <div className="relative" style={{ height: layout.height }}>
            <svg className="absolute left-0 top-0" width={layout.width} height={layout.height}>
              {layout.edges.map((e, i) => (
                <path key={i} d={e.d} fill="none" stroke={e.color} strokeWidth={2} strokeDasharray={e.dashed ? "4 4" : undefined} strokeLinecap="round" />
              ))}
              {layout.rows.map((row) => {
                const x = layout.xOf(row.lane), y = layout.yOf.get(row.key)!;
                const color = layout.lanes[row.lane]?.color ?? MAIN_COLOR;
                const active = selectedKey === row.key;
                if (row.kind === "head") {
                  return <circle key={row.key} cx={x} cy={y} r={6} fill="var(--background)" stroke={color} strokeWidth={2.5} className="cursor-pointer" onClick={() => select({ kind: "head", branch: row.branch })} />;
                }
                const c = row.commit;
                return (
                  <g key={row.key} className="cursor-pointer" onClick={() => select({ kind: "commit", commit: c })}>
                    {active && <circle cx={x} cy={y} r={10} fill={color} opacity={0.2} />}
                    {c.source === "merge"
                      ? <circle cx={x} cy={y} r={6.5} fill="var(--background)" stroke={color} strokeWidth={3} />
                      : c.actor === "ai"
                        ? <rect x={x - 6} y={y - 6} width={12} height={12} rx={3} fill={color} stroke="var(--background)" strokeWidth={1.5} />
                        : <circle cx={x} cy={y} r={5.5} fill={color} stroke="var(--background)" strokeWidth={1.5} />}
                  </g>
                );
              })}
            </svg>

            {/* Row labels */}
            {layout.rows.map((row) => {
              const y = layout.yOf.get(row.key)!;
              const left = layout.width + 6;
              if (row.kind === "head") {
                if (row.branch) return null; // heads share the first row; describe them once
                const openBranches = branches.filter((b) => b.status === "open");
                return (
                  <button key={row.key} onClick={() => select({ kind: "head", branch: null })}
                    className={`absolute right-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-hover ${selectedKey === row.key ? "bg-hover" : ""}`}
                    style={{ top: y - 15, left }}>
                    <span className="font-medium">현재</span>
                    <span className="truncate text-xs text-muted">메인{openBranches.length ? ` · 작업 중인 브랜치 ${openBranches.length}개` : ""}</span>
                  </button>
                );
              }
              const c = row.commit;
              const who = c.actor === "ai" ? undefined : c.edited_by ? memberMap.get(c.edited_by) : undefined;
              const lane = layout.lanes[row.lane];
              return (
                <button key={row.key} onClick={() => select({ kind: "commit", commit: c })}
                  className={`absolute right-2 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-hover ${selectedKey === row.key ? "bg-hover" : ""}`}
                  style={{ top: y - 18, left }}>
                  {c.actor === "ai" ? <span className="text-base leading-none">🤖</span> : <Avatar profile={who} size={18} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {c.label || SOURCE[c.source] || c.source}
                    </span>
                    <span className="block truncate text-[11px] text-muted">
                      {c.actor === "ai" ? (c.actor_name ?? "AI") : who?.display_name ?? "알 수 없음"} · {time(c.created_at)}
                      {lane?.branch ? ` · ${lane.branch.name}` : ""}{c.label && SOURCE[c.source] ? ` · ${SOURCE[c.source]}` : ""}
                    </span>
                  </span>
                  {counts[c.id] ? <span className="shrink-0 text-[11px] text-muted">💬{counts[c.id]}</span> : null}
                </button>
              );
            })}
          </div>
        )}
        {commits?.length === 0 && (
          <p className="px-6 pb-6 text-center text-sm text-muted">아직 버전이 없어요. 문서를 고치거나 “지금 저장”을 누르면 노드가 생깁니다.</p>
        )}
      </div>

      {sel && (
        <NodeCard
          sel={sel}
          canEdit={canEdit}
          meId={me.id}
          currentBranchId={currentBranchId}
          branches={branches}
          onPreview={onPreview}
          onFork={onFork}
          onRestore={onRestore}
          onOpenBranch={onOpenBranch}
          onMerge={onMerge}
          onCloseBranch={onCloseBranch}
          onDismiss={() => select(null)}
        />
      )}
    </aside>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
}

/* ------------------------------------------------------------------ */
/* Selected node: actions + comments                                   */
/* ------------------------------------------------------------------ */

function NodeCard({
  sel, canEdit, meId, currentBranchId, branches, onPreview, onFork, onRestore, onOpenBranch, onMerge, onCloseBranch, onDismiss,
}: {
  sel: MapSelection;
  canEdit: boolean;
  meId: string;
  currentBranchId: string | null;
  branches: Branch[];
  onPreview: (c: Commit) => void;
  onFork: (from: Commit | null) => void;
  onRestore: (c: Commit) => void;
  onOpenBranch: (b: Branch | null) => void;
  onMerge: (b: Branch) => void;
  onCloseBranch: (b: Branch) => void;
  onDismiss: () => void;
}) {
  const { memberMap } = useWorkspace();
  const btn = "flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-hover";
  const primary = "flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white";

  if (sel.kind === "head") {
    const b = sel.branch;
    const openBranches = branches.filter((x) => x.status === "open");
    return (
      <div className="max-h-[45%] overflow-y-auto border-t border-line bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_20px_rgba(0,0,0,0.06)]">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">{b ? `🌿 ${b.name}` : "현재 · 메인"}</span>
          <button onClick={onDismiss} className="rounded p-1 text-muted hover:bg-hover"><X size={14} /></button>
        </div>
        {!b && (
          <>
            <p className="mb-2 text-xs text-muted">지금 모두가 함께 편집 중인 메인 문서예요.</p>
            <div className="flex flex-wrap gap-1.5">
              {currentBranchId && <button className={primary} onClick={() => onOpenBranch(null)}><Eye size={13} /> 메인 문서로 가기</button>}
              {canEdit && <button className={btn} onClick={() => onFork(null)}><GitBranch size={13} /> 지금 상태에서 내 브랜치 만들기</button>}
            </div>
            {openBranches.length > 0 && (
              <div className="mt-3 space-y-1">
                <div className="text-xs font-semibold text-muted">작업 중인 브랜치</div>
                {openBranches.map((x) => (
                  <button key={x.id} onClick={() => onOpenBranch(x)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover">
                    <Avatar profile={memberMap.get(x.owner_id)} size={18} />
                    <span className="min-w-0 flex-1 truncate">{memberMap.get(x.owner_id)?.display_name} / {x.name}</span>
                    {x.id === currentBranchId && <span className="text-xs text-accent">여는 중</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const c = sel.commit;
  const branch = c.branch_id ? branches.find((b) => b.id === c.branch_id) ?? null : null;
  const mineBranch = branch && branch.owner_id === meId;
  return (
    <div className="max-h-[55%] overflow-y-auto border-t border-line bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_20px_rgba(0,0,0,0.06)]">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            {c.actor === "ai" ? "🤖" : <GitCommitVertical size={14} />}
            <span className="truncate">{c.label || SOURCE[c.source]}</span>
          </div>
          <div className="text-xs text-muted">
            {branch ? `🌿 ${memberMap.get(branch.owner_id)?.display_name} / ${branch.name}` : "메인"} · {SOURCE[c.source]} ·{" "}
            {c.actor === "ai" ? `${c.actor_name ?? "AI"} (${memberMap.get(c.edited_by ?? "")?.display_name ?? "?"}의 토큰)` : memberMap.get(c.edited_by ?? "")?.display_name ?? "알 수 없음"} · {time(c.created_at)}
          </div>
        </div>
        <button onClick={onDismiss} className="rounded p-1 text-muted hover:bg-hover"><X size={14} /></button>
      </div>
      <div className="my-2 flex flex-wrap gap-1.5">
        <button className={btn} onClick={() => onPreview(c)}><Eye size={13} /> 지금 문서와 비교</button>
        {canEdit && <button className={primary} onClick={() => onFork(c)}><GitBranch size={13} /> 이 버전에서 브랜치 만들어 쓰기</button>}
        {canEdit && <button className={btn} onClick={() => onRestore(c)}><RotateCcw size={13} /> {currentBranchId ? "이 브랜치에 불러오기" : "메인에 복원"}</button>}
        {branch && branch.status === "open" && (
          <>
            <button className={btn} onClick={() => onOpenBranch(branch)}><GitBranch size={13} /> 브랜치 열기</button>
            {(mineBranch || canEdit) && <button className={btn} onClick={() => onMerge(branch)}><GitMerge size={13} /> 메인에 합치기</button>}
            {mineBranch && <button className={btn} onClick={() => onCloseBranch(branch)}><Trash2 size={13} /> 브랜치 닫기</button>}
          </>
        )}
      </div>
      <NodeComments versionId={c.id} />
    </div>
  );
}

function NodeComments({ versionId }: { versionId: string }) {
  const { sb, me, workspace, memberMap, role } = useWorkspace();
  const [items, setItems] = useState<VComment[]>([]);
  const [body, setBody] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await sb.from("version_comments").select("id, version_id, user_id, body, created_at").eq("version_id", versionId).order("created_at");
    setItems((data ?? []) as VComment[]);
  }, [sb, versionId]);
  useEffect(() => { void load(); }, [load]);

  async function send() {
    const t = body.trim();
    if (!t) return;
    setBody("");
    await sb.from("version_comments").insert({ version_id: versionId, workspace_id: workspace.id, user_id: me.id, body: t });
    await load();
  }

  return (
    <div className="border-t border-line pt-2">
      <div className="mb-1 text-xs font-semibold text-muted">의견 {items.length ? items.length : ""}</div>
      <div className="space-y-1.5">
        {items.map((c) => {
          const who = memberMap.get(c.user_id);
          return (
            <div key={c.id} className="group flex items-start gap-2 text-sm">
              <Avatar profile={who} size={18} />
              <div className="min-w-0 flex-1">
                <span className="mr-1 text-xs font-medium">{who?.display_name ?? "?"}</span>
                <span className="text-xs text-muted">{time(c.created_at)}</span>
                <p className="whitespace-pre-wrap break-words">{c.body}</p>
              </div>
              {(c.user_id === me.id || role === "owner") && (
                <button title="삭제" onClick={async () => { await sb.from("version_comments").delete().eq("id", c.id); await load(); }}
                  className="touch-show rounded p-1 text-muted opacity-0 hover:bg-hover group-hover:opacity-100">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="mt-2 flex gap-1.5">
        <input
          ref={inputRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          placeholder="이 버전에 대한 의견…"
          className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1 text-sm outline-none focus:border-accent"
        />
        <button disabled={!body.trim()} className="rounded-md bg-accent px-2 text-white disabled:opacity-40"><Send size={14} /></button>
      </form>
    </div>
  );
}
