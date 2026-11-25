"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useWorkspace } from "./workspace-context";

interface Token {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "아직 안 씀";

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="relative">
        <pre className="scrollbar-thin overflow-x-auto rounded-md bg-hover p-3 pr-10 font-mono text-xs leading-relaxed">{value}</pre>
        <button
          title="복사"
          onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}
          className="absolute right-2 top-2 rounded p-1 text-muted hover:bg-background"
        >
          {done ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

/** Settings section: personal API tokens for connecting Claude (MCP). */
export function ClaudeConnect() {
  const { sb, me } = useWorkspace();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("내 AI 도구");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<"claude-code" | "claude-desktop" | "codex">("claude-code");
  const endpoint = typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : "/api/mcp";

  const load = async () => {
    const { data } = await sb.from("api_tokens").select("id, name, token_prefix, created_at, last_used_at").order("created_at", { ascending: false });
    setTokens((data ?? []) as Token[]);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [me.id]);

  async function create() {
    setBusy(true);
    setError(null);
    const { data, error } = await sb.rpc("create_api_token", { p_name: name });
    setBusy(false);
    if (error) return setError(error.message);
    setFresh(data as string);
    await load();
  }

  async function revoke(t: Token) {
    if (!confirm(`'${t.name}' 토큰을 폐기할까요? 이 토큰을 쓰는 AI는 더 이상 접근할 수 없습니다.`)) return;
    await sb.from("api_tokens").delete().eq("id", t.id);
    await load();
  }

  const tok = fresh ?? "<여기에 토큰>";

  return (
    <section className="space-y-4 rounded-xl border border-line p-5">
      <div>
        <h2 className="font-semibold">🤖 AI 연결 (MCP) — Claude · Codex</h2>
        <p className="mt-1 text-sm text-muted">
          Claude나 Codex가 내 권한으로 Newtion 문서를 읽고 고칠 수 있게 연결합니다. AI의 수정은 열려 있는 편집기에 실시간으로 나타나고,
          내가 속한 워크스페이스에만 접근합니다. 뷰어인 워크스페이스는 읽기만 됩니다.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="토큰 이름 (예: 내 노트북 Claude Code)"
          className="min-w-0 flex-1 basis-48 rounded-md border border-line bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button disabled={busy} onClick={create} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-60">
          <KeyRound size={14} /> 토큰 발급
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}

      {fresh && (
        <div className="space-y-3 rounded-lg border border-amber-400/60 bg-amber-50/60 p-3 dark:bg-amber-950/20">
          <p className="text-sm font-medium">⚠️ 이 토큰은 지금만 보여요. 복사해 두세요. 잃어버리면 폐기하고 새로 발급하면 됩니다.</p>
          <CopyBlock label="토큰" value={fresh} />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex gap-1 rounded-lg bg-hover p-0.5 text-sm">
          {(["claude-code", "claude-desktop", "codex"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setClient(k)}
              className={`flex-1 rounded-md px-2 py-1 ${client === k ? "bg-background font-medium shadow-sm" : "text-muted"}`}
            >
              {k === "claude-code" ? "Claude Code" : k === "claude-desktop" ? "Claude 데스크톱" : "Codex"}
            </button>
          ))}
        </div>

        {client === "claude-code" && (
          <CopyBlock
            label="터미널에서 한 번 실행"
            value={`claude mcp add --transport http newtion ${endpoint} --header "Authorization: Bearer ${tok}"`}
          />
        )}

        {client === "claude-desktop" && (
          <CopyBlock
            label={"설정 → 데스크톱 앱 → 확장 프로그램 '관리' → 로컬 MCP 서버 '구성 편집' → claude_desktop_config.json 바깥 { } 안에 \"mcpServers\" 항목으로 넣고 Claude 재시작 (Node.js 필요)"}
            value={JSON.stringify({
              mcpServers: {
                newtion: {
                  command: "npx",
                  args: ["-y", "mcp-remote", endpoint, "--header", "Authorization:${NEWTION_TOKEN}"],
                  env: { NEWTION_TOKEN: `Bearer ${tok}` },
                },
              },
            }, null, 2)}
          />
        )}

        {client === "codex" && (
          <>
            <CopyBlock
              label={"config.toml 맨 아래에 추가 — Windows: %USERPROFILE%\\.codex\\config.toml · macOS/Linux: ~/.codex/config.toml (CLI·IDE 확장 공용, 저장 후 Codex 재시작)"}
              value={`[mcp_servers.newtion]\nurl = "${endpoint}"\nhttp_headers = { "Authorization" = "Bearer ${tok}" }`}
            />
            <CopyBlock
              label="또는 터미널에서: 토큰을 환경변수 NEWTION_TOKEN에 넣고 등록 (Windows는 setx 후 새 터미널에서 두 번째 줄 실행)"
              value={`setx NEWTION_TOKEN "${tok}"\ncodex mcp add newtion --url ${endpoint} --bearer-token-env-var NEWTION_TOKEN`}
            />
            <p className="text-xs text-muted">확인: <code className="rounded bg-hover px-1">codex mcp list</code>에서 newtion이 enabled로 보이면 연결된 것입니다.</p>
          </>
        )}

        <p className="text-xs text-muted">
          연결한 뒤 “Newtion 워크스페이스 목록 보여줘”, “project_sun 기획서에서 층 종류 표에 ‘화산’ 추가해줘”처럼 말하면 됩니다.
        </p>
      </div>

      {tokens.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold text-muted">발급한 토큰</div>
          <div className="divide-y divide-line">
            {tokens.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className="font-medium">{t.name}</span>
                <span className="font-mono text-xs text-muted">{t.token_prefix}…</span>
                <span className="ml-auto text-xs text-muted">마지막 사용: {fmt(t.last_used_at)}</span>
                <button title="폐기" onClick={() => revoke(t)} className="rounded p-1 text-red-500 hover:bg-hover">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
