"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, ExternalLink, Gamepad2, Maximize2, MoreHorizontal, Plus, RotateCw, Unlink, Upload, X,
} from "lucide-react";
import { unzipSync } from "fflate";
import { useWorkspace } from "./workspace-context";
import { Avatar, MenuItem, Popover } from "./ui";
import type { Game, GameBuild } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

export function gameUrl(b: Pick<GameBuild, "id" | "entry">) {
  return `/g/${b.id}/${b.entry.split("/").map(encodeURIComponent).join("/")}`;
}

/** A game and its builds (newest first), live. */
export function useGame(gameId: string | null) {
  const { sb } = useWorkspace();
  const [game, setGame] = useState<Game | null>(null);
  const [builds, setBuilds] = useState<GameBuild[] | null>(null);

  const load = useCallback(async () => {
    if (!gameId) return;
    const [{ data: g }, { data: bs }] = await Promise.all([
      sb.from("games").select("*").eq("id", gameId).maybeSingle(),
      sb.from("game_builds").select("*").eq("game_id", gameId).order("created_at", { ascending: false }),
    ]);
    setGame((g as Game) ?? null);
    setBuilds((bs ?? []) as GameBuild[]);
  }, [sb, gameId]);

  useEffect(() => {
    if (!gameId) { setGame(null); setBuilds(null); return; }
    void load();
    const ch = sb
      .channel(`game:${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_builds", filter: `game_id=eq.${gameId}` }, () => void load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` }, () => void load())
      .subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [sb, gameId, load]);

  return { game, builds, reload: load };
}

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

/**
 * The game linked to a page, playable next to the document.
 * `variant="side"`: a column beside the doc (desktop). `variant="top"`: a strip above it (phones).
 */
export function GamePanel({
  gameId, canEdit, variant, onClose, onUnlink,
}: {
  gameId: string;
  canEdit: boolean;
  variant: "side" | "top";
  onClose: () => void;
  onUnlink: () => void;
}) {
  const { memberMap } = useWorkspace();
  const { game, builds, reload } = useGame(gameId);
  const ready = useMemo(() => (builds ?? []).filter((b) => b.status === "ready"), [builds]);
  const [pick, setPick] = useState<string | null>(null); // null → latest
  const [verMenu, setVerMenu] = useState(false);
  const [menu, setMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [running, setRunning] = useState(variant === "side");
  const frameBox = useRef<HTMLDivElement>(null);

  const latest = ready.find((b) => b.id === game?.latest_build_id) ?? ready[0] ?? null;
  const current = (pick && ready.find((b) => b.id === pick)) || latest;
  const who = (b: GameBuild) => (b.actor === "ai" ? `🤖 ${b.actor_name ?? "AI"}` : memberMap.get(b.uploaded_by ?? "")?.display_name ?? "알 수 없음");

  const btn = "rounded p-1.5 text-muted hover:bg-hover hover:text-foreground disabled:opacity-40";
  const shell = variant === "side"
    ? "hidden md:flex md:h-full md:w-[46%] md:min-w-[380px] md:max-w-[960px] md:shrink-0 md:flex-col md:border-l md:border-line"
    : "flex flex-col border-b border-line md:hidden";

  return (
    <section className={`${shell} bg-background`}>
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center gap-1 px-2 text-sm">
        <Gamepad2 size={16} className="ml-1 shrink-0 text-muted" />
        <span className="min-w-0 truncate font-medium">{game?.name ?? "게임"}</span>
        <div className="relative ml-1 shrink-0">
          <button
            onClick={() => setVerMenu(true)}
            disabled={!ready.length}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover disabled:opacity-50"
          >
            {current ? current.version : "버전 없음"}
            {current && current.id === latest?.id && <span className="text-muted">· 최신</span>}
            <ChevronDown size={12} />
          </button>
          <Popover open={verMenu} onClose={() => setVerMenu(false)} className="w-72">
            <div className="scrollbar-thin max-h-80 overflow-y-auto">
              {ready.map((b) => (
                <button
                  key={b.id}
                  onClick={() => { setPick(b.id === latest?.id ? null : b.id); setVerMenu(false); setRunning(true); setRunKey((k) => k + 1); }}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover ${b.id === current?.id ? "bg-hover" : ""}`}
                >
                  {b.actor === "ai" ? <span className="w-[18px] text-center leading-[18px]">🤖</span> : <Avatar profile={memberMap.get(b.uploaded_by ?? "")} size={18} />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm">
                      <b className="font-medium">{b.version}</b>
                      {b.id === latest?.id && <span className="rounded bg-accent/10 px-1 text-[10px] text-accent">최신</span>}
                    </span>
                    {b.notes && <span className="block truncate text-xs">{b.notes}</span>}
                    <span className="block truncate text-[11px] text-muted">{who(b)} · {when(b.created_at)} · {fmtSize(b.total_size)}</span>
                  </span>
                </button>
              ))}
            </div>
          </Popover>
        </div>
        <div className="flex-1" />
        <button title="다시 시작" className={btn} disabled={!current} onClick={() => { setRunning(true); setRunKey((k) => k + 1); }}><RotateCw size={15} /></button>
        <button title="전체 화면" className={btn} disabled={!current} onClick={() => { setRunning(true); void frameBox.current?.requestFullscreen?.(); }}><Maximize2 size={15} /></button>
        {current && (
          <a title="새 탭에서 열기" className={btn} href={gameUrl(current)} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>
        )}
        {canEdit && (
          <button title="새 버전 올리기" className={btn} onClick={() => setUploading(true)}><Upload size={15} /></button>
        )}
        <div className="relative">
          <button className={btn} onClick={() => setMenu(true)}><MoreHorizontal size={15} /></button>
          <Popover open={menu} onClose={() => setMenu(false)} align="right">
            {canEdit && (
              <MenuItem onClick={() => { setMenu(false); setUploading(true); }}><Upload size={14} /> 새 버전 올리기</MenuItem>
            )}
            {canEdit && (
              <MenuItem danger onClick={() => { setMenu(false); if (confirm("이 페이지에서 게임 연결을 끊을까요? 게임과 버전은 그대로 남아요.")) onUnlink(); }}>
                <Unlink size={14} /> 이 페이지에서 연결 끊기
              </MenuItem>
            )}
          </Popover>
        </div>
        <button title="닫기" className={btn} onClick={onClose}><X size={15} /></button>
      </div>

      {/* Game */}
      <div
        ref={frameBox}
        className={`relative bg-black ${variant === "side" ? "min-h-0 flex-1" : "aspect-video w-full"}`}
      >
        {current && running ? (
          <iframe
            key={`${current.id}:${runKey}`}
            src={gameUrl(current)}
            title={`${game?.name ?? "게임"} ${current.version}`}
            // Opaque origin: the game can't reach Newtion's cookies or storage.
            sandbox="allow-scripts allow-pointer-lock allow-popups allow-modals allow-downloads allow-forms"
            allow="fullscreen; gamepad; autoplay"
            className="absolute inset-0 h-full w-full border-0"
            onLoad={(e) => e.currentTarget.focus()}
          />
        ) : current ? (
          <button onClick={() => setRunning(true)} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-2xl">▶</span>
            <span className="text-sm">{current.version} 실행</span>
          </button>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/70">
            {builds === null ? "불러오는 중…" : (
              <>
                <span>아직 올라온 버전이 없어요.</span>
                {canEdit && (
                  <button onClick={() => setUploading(true)} className="flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-black">
                    <Upload size={14} /> 첫 버전 올리기
                  </button>
                )}
                <span className="text-xs text-white/50">SDL2 등을 Emscripten으로 빌드한 웹 결과물(.html · .js · .wasm · .data)</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Version note */}
      {current && variant === "side" && (
        <div className="shrink-0 border-t border-line px-3 py-2 text-xs text-muted">
          <span className="font-medium text-foreground">{current.version}</span> · {who(current)} · {when(current.created_at)} · 파일 {current.files.length}개 {fmtSize(current.total_size)}
          {current.notes && <p className="mt-0.5 whitespace-pre-wrap text-foreground">{current.notes}</p>}
        </div>
      )}

      {uploading && game && (
        <UploadDialog
          game={game}
          builds={builds ?? []}
          onClose={() => setUploading(false)}
          onDone={() => { setUploading(false); setPick(null); setRunning(true); setRunKey((k) => k + 1); void reload(); }}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

interface PickedFile { path: string; file: Blob; size: number }

const MIME: Record<string, string> = {
  html: "text/html", htm: "text/html", js: "text/javascript", mjs: "text/javascript", wasm: "application/wasm",
  data: "application/octet-stream", json: "application/json", css: "text/css", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", ogg: "audio/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
  txt: "text/plain", map: "application/json",
};
const mimeOf = (p: string) => MIME[p.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** Strips a folder all files share (e.g. "build/"), and junk like __MACOSX / .DS_Store. */
function normalize(files: PickedFile[]): PickedFile[] {
  let list = files.filter((f) => !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git)(\/|$)/.test(f.path));
  for (;;) {
    const first = list[0]?.path.split("/")[0];
    if (!first || list.some((f) => !f.path.startsWith(first + "/"))) break;
    list = list.map((f) => ({ ...f, path: f.path.slice(first.length + 1) }));
  }
  return list;
}

async function fromZip(z: File): Promise<PickedFile[]> {
  const entries = unzipSync(new Uint8Array(await z.arrayBuffer()));
  return Object.entries(entries)
    .filter(([name]) => !name.endsWith("/"))
    .map(([name, data]) => ({ path: name, file: new Blob([data as BlobPart]), size: data.byteLength }));
}

async function fromEntry(entry: FileSystemEntry, prefix = ""): Promise<PickedFile[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    return [{ path: prefix + entry.name, file, size: file.size }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map((c) => fromEntry(c, prefix + entry.name + "/")))).flat();
}

async function collect(files: File[]): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name) && files.length === 1) out.push(...(await fromZip(f)));
    else out.push({ path: f.webkitRelativePath || f.name, file: f, size: f.size });
  }
  return normalize(out);
}

function nextVersion(builds: GameBuild[]) {
  const last = builds[0]?.version;
  if (!last) return "v0.1";
  const m = last.match(/^(.*?)(\d+)(\D*)$/);
  return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : `${last}-2`;
}

function UploadDialog({ game, builds, onClose, onDone }: { game: Game; builds: GameBuild[]; onClose: () => void; onDone: () => void }) {
  const { sb, me } = useWorkspace();
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [version, setVersion] = useState(() => nextVersion(builds));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  const total = files.reduce((n, f) => n + f.size, 0);
  const htmls = files.filter((f) => /\.html?$/i.test(f.path));
  const entry = htmls.find((f) => /(^|\/)index\.html$/i.test(f.path))?.path ?? htmls.sort((a, b) => a.path.length - b.path.length)[0]?.path;

  const take = async (list: File[]) => {
    setError(null);
    try { setFiles(await collect(list)); } catch (e) { setError(`파일을 읽지 못했어요: ${(e as Error).message}`); }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const items = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    if (items.some((i) => i.isDirectory)) {
      setError(null);
      setFiles(normalize((await Promise.all(items.map((i) => fromEntry(i)))).flat()));
    } else await take([...e.dataTransfer.files]);
  };

  async function upload() {
    if (!entry) return setError(".html 파일이 없어요. Emscripten 빌드 결과물 전체(.html · .js · .wasm · .data)를 올려 주세요.");
    setBusy(true);
    setError(null);
    const { data: build, error: e1 } = await sb.from("game_builds").insert({
      game_id: game.id, workspace_id: game.workspace_id, version: version.trim() || nextVersion(builds),
      notes: notes.trim() || null, entry, uploaded_by: me.id,
    }).select("id").single();
    if (e1 || !build) { setBusy(false); return setError(e1?.message ?? "버전을 만들지 못했어요."); }

    let done = 0;
    setProgress({ done, total });
    const queue = [...files];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const { error } = await sb.storage.from("games").upload(`${build.id}/${f.path}`, f.file, {
          contentType: mimeOf(f.path), cacheControl: "31536000", upsert: false,
        });
        if (error) throw new Error(`${f.path}: ${error.message}`);
        done += f.size;
        setProgress({ done, total });
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
      const { error: e2 } = await sb.rpc("publish_game_build", { p_build: build.id, p_entry: entry });
      if (e2) throw e2;
      onDone();
    } catch (e) {
      await sb.from("game_builds").delete().eq("id", build.id);
      setError(`업로드 실패: ${(e as Error).message}${/exceeded|too large|maximum/i.test((e as Error).message) ? " (파일 하나가 업로드 한도를 넘었어요)" : ""}`);
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[96] flex items-end justify-center bg-black/40 md:items-center" onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-t-2xl bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl md:rounded-xl">
        <div className="mb-3 flex items-center justify-between">
          <b className="text-base">{game.name} · 새 버전 올리기</b>
          <button disabled={busy} onClick={onClose} className="rounded p-1 hover:bg-hover"><X size={16} /></button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => void onDrop(e)}
          className={`rounded-lg border-2 border-dashed p-4 text-center text-sm ${over ? "border-accent bg-accent/5" : "border-line"}`}
        >
          <p className="text-muted">빌드 폴더나 .zip을 끌어다 놓거나</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <button disabled={busy} onClick={() => dirInput.current?.click()} className="rounded-md border border-line px-3 py-1.5 hover:bg-hover">폴더 선택</button>
            <button disabled={busy} onClick={() => fileInput.current?.click()} className="rounded-md border border-line px-3 py-1.5 hover:bg-hover">파일 / .zip 선택</button>
          </div>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void take([...(e.target.files ?? [])]); e.target.value = ""; }} />
          <input
            ref={dirInput} type="file" multiple hidden
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => { void take([...(e.target.files ?? [])]); e.target.value = ""; }}
          />
          <p className="mt-2 text-xs text-muted">Emscripten 결과물: <code>index.html</code> · <code>.js</code> · <code>.wasm</code> · <code>.data</code> (+ 에셋)</p>
        </div>

        {files.length > 0 && (
          <div className="mt-3 max-h-36 overflow-y-auto rounded-md border border-line p-2 text-xs scrollbar-thin">
            {files.map((f) => (
              <div key={f.path} className="flex justify-between gap-2">
                <span className={`truncate ${f.path === entry ? "font-semibold" : ""}`}>{f.path}{f.path === entry ? "  ← 시작 파일" : ""}</span>
                <span className="shrink-0 text-muted">{fmtSize(f.size)}</span>
              </div>
            ))}
          </div>
        )}
        {files.length > 0 && <p className="mt-1 text-xs text-muted">파일 {files.length}개 · {fmtSize(total)}</p>}

        <div className="mt-3 grid gap-2">
          <label className="text-xs text-muted">버전 이름
            <input value={version} onChange={(e) => setVersion(e.target.value)} maxLength={60}
              className="mt-0.5 w-full rounded-md border border-line bg-transparent px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">변경 사항 (선택)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="예: 점프 높이 조정, 보스 패턴 2 추가"
              className="mt-0.5 w-full resize-none rounded-md border border-line bg-transparent px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
        </div>

        {progress && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-hover">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">{fmtSize(progress.done)} / {fmtSize(progress.total)}</p>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

        <button
          disabled={busy || !files.length}
          onClick={() => void upload()}
          className="mt-3 w-full rounded-md bg-accent py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "올리는 중…" : "올리고 최신 버전으로 지정"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Linking a game to a page                                            */
/* ------------------------------------------------------------------ */

export function GameLinkDialog({ pageTitle, onLink, onClose }: { pageTitle: string; onLink: (gameId: string) => Promise<void>; onClose: () => void }) {
  const { sb, me, workspace } = useWorkspace();
  const [games, setGames] = useState<Game[] | null>(null);
  const [name, setName] = useState(pageTitle.replace(/기획서|GDD/gi, "").trim() || "새 게임");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void sb.from("games").select("*").eq("workspace_id", workspace.id).order("updated_at", { ascending: false })
      .then(({ data }) => setGames((data ?? []) as Game[]));
  }, [sb, workspace.id]);

  async function create() {
    setBusy(true);
    const { data, error } = await sb.from("games").insert({ workspace_id: workspace.id, name: name.trim().slice(0, 80) || "새 게임", created_by: me.id }).select("id").single();
    if (error || !data) { setBusy(false); return alert(error?.message ?? "게임을 만들지 못했어요."); }
    await onLink(data.id);
  }

  return (
    <div className="fixed inset-0 z-[96] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-2xl bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl md:rounded-xl">
        <div className="mb-3 flex items-center justify-between">
          <b className="flex items-center gap-2 text-base"><Gamepad2 size={18} /> 이 페이지에 게임 붙이기</b>
          <button onClick={onClose} className="rounded p-1 hover:bg-hover"><X size={16} /></button>
        </div>
        <p className="mb-3 text-sm text-muted">기획서 옆에서 웹 빌드(SDL2 · Emscripten)를 바로 실행하고, 버전별로 올려 둘 수 있어요.</p>

        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="게임 이름"
            className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-accent" />
          <button disabled={busy} onClick={() => void create()} className="flex items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-50">
            <Plus size={14} /> 새 게임
          </button>
        </div>

        {!!games?.length && (
          <>
            <div className="mb-1 mt-4 text-xs font-semibold text-muted">이미 있는 게임 연결</div>
            <div className="max-h-60 overflow-y-auto scrollbar-thin">
              {games.map((g) => (
                <button key={g.id} disabled={busy} onClick={async () => { setBusy(true); await onLink(g.id); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-hover">
                  <Gamepad2 size={15} className="text-muted" /> <span className="truncate">{g.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
