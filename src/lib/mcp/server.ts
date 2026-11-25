import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { DbProperty, DbSchema, OptionColor, PropValue } from "@/lib/types";
import {
  applyBlocks, blocksOf, blocksToMarkdown, docFromStored, encodeDoc, markdownToBlocks, withLiveDoc, type AnyBlock,
} from "./docs";
import * as Y from "yjs";

interface PageData {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  kind: "doc" | "database" | "row";
  title: string;
  icon: string | null;
  content: AnyBlock[];
  ydoc: string | null;
  db_schema: DbSchema | null;
  properties: Record<string, PropValue>;
  archived: boolean;
  role: "owner" | "editor" | "viewer";
  parent_schema: DbSchema | null;
  members: { user_id: string; name: string; email: string }[] | null;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://project-newtion.vercel.app";
const COLORS: OptionColor[] = ["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink", "brown"];

export function anonClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

class ToolError extends Error {}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

/** Wraps a tool body so permission / not-found errors come back as readable tool errors. */
function guard<A>(fn: (args: A) => Promise<ReturnType<typeof text>>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (/no permission/.test(msg)) return fail("권한이 없습니다. 이 워크스페이스의 멤버가 아니거나, 뷰어라서 수정할 수 없습니다.");
      if (/page not found|not found/.test(msg)) return fail("페이지를 찾을 수 없습니다. list_pages나 search로 id를 확인하세요.");
      if (/invalid token/.test(msg)) return fail("토큰이 올바르지 않거나 폐기되었습니다. Newtion 설정에서 새 토큰을 발급하세요.");
      return fail(msg);
    }
  };
}

export function createNewtionMcp(token: string) {
  const sb = anonClient();

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.rpc(fn, { p_token: token, ...args });
    if (error) throw new ToolError(error.message);
    return data as T;
  }
  const getPage = (id: string) => rpc<PageData>("mcp_get_page", { p_page: id });
  const pageUrl = (p: { workspace_id: string; id: string }) => `${APP_URL}/w/${p.workspace_id}/p/${p.id}`;

  /** Current body of a page as Markdown (from the live Yjs state if it has one). */
  async function bodyMarkdown(p: PageData) {
    return blocksToMarkdown(blocksOf(docFromStored(p.ydoc, p.content)));
  }

  /** Writes new blocks into a page through the live collaboration channel, then saves.
   *  The state right before the edit is kept as a version (source / label). */
  /** Writes new blocks into a page through the live collaboration channel, saves,
   *  and records the result as an AI commit on the version map (one node per edit). */
  async function writeBody(p: PageData, blocks: AnyBlock[], message: string, source: "mcp" | "restore" = "mcp") {
    if (p.role === "viewer") throw new ToolError("no permission");
    if (p.kind === "database") throw new ToolError("데이터베이스 페이지에는 본문이 없습니다. 항목은 add_database_row로 추가하세요.");
    const doc = docFromStored(p.ydoc, p.content);
    const stats = await withLiveDoc(p.id, doc, (d) => applyBlocks(d, blocks));
    const after = blocksOf(doc);
    await rpc("mcp_save_page", { p_page: p.id, p_content: after, p_ydoc: encodeDoc(doc) });
    if (stats.changed) {
      await rpc("mcp_create_version", { p_page: p.id, p_title: p.title, p_content: after, p_source: source, p_label: message.slice(0, 120) });
    }
    return stats;
  }

  // ---- database helpers ----
  const findProp = (schema: DbSchema, key: string) =>
    schema.properties.find((p) => p.name === key || p.id === key) ??
    schema.properties.find((p) => p.name.toLowerCase() === key.toLowerCase());

  function readValue(prop: DbProperty, v: PropValue | undefined, members: PageData["members"]): unknown {
    if (v == null || v === "") return null;
    const opt = (id: unknown) => prop.options?.find((o) => o.id === id)?.name ?? id;
    switch (prop.type) {
      case "select":
      case "status": return opt(v);
      case "multi_select": return Array.isArray(v) ? v.map(opt) : [];
      case "person": return members?.find((m) => m.user_id === v)?.name ?? v;
      default: return v;
    }
  }

  /** Converts {property name: value} into stored ids; creates missing select options. Returns props + whether the schema changed. */
  function toStored(schema: DbSchema, input: Record<string, unknown>, members: PageData["members"]) {
    const out: Record<string, PropValue> = {};
    let changed = false;
    const optionId = (prop: DbProperty, name: string) => {
      prop.options ??= [];
      const found = prop.options.find((o) => o.name === name || o.id === name) ??
        prop.options.find((o) => o.name.toLowerCase() === name.toLowerCase());
      if (found) return found.id;
      const id = "o" + Math.random().toString(36).slice(2, 9);
      prop.options.push({ id, name, color: COLORS[prop.options.length % COLORS.length] });
      changed = true;
      return id;
    };
    for (const [key, value] of Object.entries(input)) {
      const prop = findProp(schema, key);
      if (!prop) throw new ToolError(`속성 '${key}'이(가) 없습니다. 있는 속성: ${schema.properties.map((p) => p.name).join(", ")}`);
      if (value == null || value === "") { out[prop.id] = null; continue; }
      switch (prop.type) {
        case "select":
        case "status": out[prop.id] = optionId(prop, String(value)); break;
        case "multi_select": out[prop.id] = (Array.isArray(value) ? value : String(value).split(",")).map((s) => optionId(prop, String(s).trim())); break;
        case "number": {
          const n = Number(value);
          if (Number.isNaN(n)) throw new ToolError(`'${prop.name}'은 숫자여야 합니다.`);
          out[prop.id] = n; break;
        }
        case "checkbox": out[prop.id] = value === true || value === "true" || value === "예"; break;
        case "person": {
          const m = members?.find((x) => x.user_id === value || x.name === value || x.email === value);
          if (!m) throw new ToolError(`'${value}' 멤버를 찾을 수 없습니다. 멤버: ${(members ?? []).map((x) => x.name).join(", ")}`);
          out[prop.id] = m.user_id; break;
        }
        default: out[prop.id] = String(value);
      }
    }
    return { props: out, changed };
  }

  const server = new McpServer(
    { name: "newtion", version: "1.0.0" },
    {
      instructions:
        "Newtion은 게임 개발팀용 노션 스타일 협업 문서 서비스입니다. 문서를 고치기 전에 read_page로 현재 내용을 읽으세요. " +
        "본문은 Markdown으로 주고받습니다. 일부만 고칠 때는 edit_page(찾아 바꾸기)를, 전체를 다시 쓸 때만 update_page를 쓰세요. " +
        "수정은 열려 있는 편집기에 실시간으로 반영되고, 바뀐 블록만 교체되어 다른 블록의 서식은 유지됩니다.",
    },
  );

  server.registerTool("list_workspaces", {
    title: "워크스페이스 목록",
    description: "내가 속한 워크스페이스와 내 역할(owner/editor/viewer)을 보여줍니다.",
    annotations: { readOnlyHint: true },
  }, guard(async () => {
    const ws = await rpc<{ id: string; name: string; icon: string; role: string }[]>("mcp_list_workspaces", {});
    if (!ws.length) return text("속한 워크스페이스가 없습니다.");
    return text(ws.map((w) => `- ${w.icon} ${w.name} (역할: ${w.role}) id=${w.id}`).join("\n"));
  }));

  server.registerTool("list_pages", {
    title: "페이지 트리",
    description: "워크스페이스의 페이지(문서·데이터베이스)를 트리로 보여줍니다. 데이터베이스 항목은 query_database로 봅니다.",
    inputSchema: { workspace_id: z.string().uuid() },
    annotations: { readOnlyHint: true },
  }, guard(async ({ workspace_id }: { workspace_id: string }) => {
    const pages = await rpc<{ id: string; parent_id: string | null; kind: string; title: string; icon: string | null }[]>(
      "mcp_list_pages", { p_workspace: workspace_id });
    const kids = new Map<string | null, typeof pages>();
    for (const p of pages) kids.set(p.parent_id, [...(kids.get(p.parent_id) ?? []), p]);
    const lines: string[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const p of kids.get(parent) ?? []) {
        lines.push(`${"  ".repeat(depth)}- ${p.icon ?? (p.kind === "database" ? "🗃️" : "📄")} ${p.title || "제목 없음"}${p.kind === "database" ? " [데이터베이스]" : ""} id=${p.id}`);
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return text(lines.length ? lines.join("\n") : "페이지가 없습니다.");
  }));

  server.registerTool("search", {
    title: "검색",
    description: "제목과 본문에서 검색합니다. workspace_id를 주면 그 워크스페이스만 찾습니다.",
    inputSchema: { query: z.string().min(1), workspace_id: z.string().uuid().optional() },
    annotations: { readOnlyHint: true },
  }, guard(async ({ query, workspace_id }: { query: string; workspace_id?: string }) => {
    const r = await rpc<{ id: string; workspace: string; kind: string; title: string; match: string }[]>(
      "mcp_search", { p_query: query, p_workspace: workspace_id ?? null });
    if (!r.length) return text(`'${query}'에 대한 결과가 없습니다.`);
    return text(r.map((x) => `- ${x.title || "제목 없음"} (${x.kind}, ${x.workspace}, ${x.match === "title" ? "제목" : "본문"}에서 일치) id=${x.id}`).join("\n"));
  }));

  server.registerTool("read_page", {
    title: "페이지 읽기",
    description: "페이지의 제목과 본문(Markdown)을 읽습니다. 데이터베이스 항목이면 속성도, 데이터베이스면 속성 정의와 항목 목록을 보여줍니다.",
    inputSchema: { page_id: z.string().uuid() },
    annotations: { readOnlyHint: true },
  }, guard(async ({ page_id }: { page_id: string }) => {
    const p = await getPage(page_id);
    const head = [`# ${p.icon ? p.icon + " " : ""}${p.title || "제목 없음"}`, `id=${p.id} · 종류=${p.kind} · 내 역할=${p.role}${p.archived ? " · 휴지통에 있음" : ""}`, `링크: ${pageUrl(p)}`];
    if (p.kind === "database") {
      return text([...head, "", "이 페이지는 데이터베이스입니다. query_database로 속성과 항목을 보세요."].join("\n"));
    }
    if (p.kind === "row" && p.parent_schema) {
      head.push("", "속성:");
      for (const prop of p.parent_schema.properties) {
        const v = readValue(prop, p.properties[prop.id], p.members);
        head.push(`- ${prop.name} (${prop.type}): ${v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v)}`);
      }
    }
    const md = await bodyMarkdown(p);
    return text([...head, "", "---", md || "(본문 없음)"].join("\n"));
  }));

  server.registerTool("edit_page", {
    title: "본문 일부 고치기",
    description:
      "본문에서 old_text를 찾아 new_text로 바꿉니다(read_page가 돌려준 Markdown 기준, 정확히 일치해야 함). " +
      "여러 군데 있으면 replace_all을 켜거나 앞뒤 문맥을 더 넣으세요. 바뀐 블록만 교체됩니다.",
    inputSchema: { page_id: z.string().uuid(), old_text: z.string().min(1), new_text: z.string(), replace_all: z.boolean().optional() },
    annotations: { destructiveHint: false, idempotentHint: false },
  }, guard(async ({ page_id, old_text, new_text, replace_all }: { page_id: string; old_text: string; new_text: string; replace_all?: boolean }) => {
    const p = await getPage(page_id);
    const md = await bodyMarkdown(p);
    const count = md.split(old_text).length - 1;
    if (count === 0) return fail("old_text를 본문에서 찾지 못했습니다. read_page로 현재 Markdown을 다시 읽고, 공백·기호까지 똑같이 복사해 주세요.");
    if (count > 1 && !replace_all) return fail(`old_text가 ${count}군데 있습니다. 앞뒤 문맥을 더 넣어 하나로 좁히거나 replace_all을 켜세요.`);
    const next = replace_all ? md.split(old_text).join(new_text) : md.replace(old_text, new_text);
    const short = (t: string) => (t.length > 24 ? t.slice(0, 24) + "…" : t).replace(/\s+/g, " ");
    const s = await writeBody(p, await markdownToBlocks(next), `‘${short(old_text)}’ → ‘${short(new_text)}’`);
    return text(`고쳤습니다: ${count}군데 · 블록 ${s.removed}개 → ${s.added}개 교체. ${pageUrl(p)}`);
  }));

  server.registerTool("update_page", {
    title: "본문 전체 바꾸기",
    description: "본문 전체를 주어진 Markdown으로 바꿉니다. 내용이 같은 블록은 그대로 두고 바뀐 블록만 교체합니다. 일부만 고칠 때는 edit_page를 쓰세요.",
    inputSchema: { page_id: z.string().uuid(), markdown: z.string() },
  }, guard(async ({ page_id, markdown }: { page_id: string; markdown: string }) => {
    const p = await getPage(page_id);
    const s = await writeBody(p, await markdownToBlocks(markdown), "본문 전체 다시 쓰기");
    return text(s.changed ? `바꿨습니다: 블록 ${s.removed}개 제거, ${s.added}개 추가. ${pageUrl(p)}` : "바뀐 내용이 없습니다.");
  }));

  server.registerTool("append_to_page", {
    title: "본문 끝에 덧붙이기",
    description: "본문 맨 끝에 Markdown 내용을 덧붙입니다.",
    inputSchema: { page_id: z.string().uuid(), markdown: z.string().min(1) },
  }, guard(async ({ page_id, markdown }: { page_id: string; markdown: string }) => {
    const p = await getPage(page_id);
    const current = blocksOf(docFromStored(p.ydoc, p.content));
    const extra = await markdownToBlocks(markdown);
    const firstLine = markdown.split("\n").find((l) => l.trim())?.replace(/^[#>*\-\s\d.]+/, "").slice(0, 40) ?? "";
    const s = await writeBody(p, [...current, ...extra], `덧붙이기: ${firstLine}`);
    return text(`덧붙였습니다: 블록 ${s.added}개. ${pageUrl(p)}`);
  }));

  server.registerTool("create_page", {
    title: "페이지 만들기",
    description: "새 문서 페이지를 만듭니다. parent_id를 주면 그 페이지 아래(하위 페이지)에 만듭니다.",
    inputSchema: {
      workspace_id: z.string().uuid(),
      title: z.string().min(1),
      markdown: z.string().optional(),
      parent_id: z.string().uuid().optional(),
      icon: z.string().max(8).optional(),
    },
  }, guard(async ({ workspace_id, title, markdown, parent_id, icon }: { workspace_id: string; title: string; markdown?: string; parent_id?: string; icon?: string }) => {
    const blocks = markdown ? await markdownToBlocks(markdown) : [];
    const doc = new Y.Doc();
    await applyBlocks(doc, blocks);
    const id = await rpc<string>("mcp_create_page", {
      p_workspace: workspace_id, p_parent: parent_id ?? null, p_kind: "doc", p_title: title, p_icon: icon ?? null,
      p_content: blocksOf(doc), p_properties: {}, p_db_schema: null,
    });
    await rpc("mcp_save_page", { p_page: id, p_ydoc: encodeDoc(doc) });
    return text(`만들었습니다: ${title} id=${id} ${pageUrl({ workspace_id, id })}`);
  }));

  server.registerTool("rename_page", {
    title: "제목·아이콘 바꾸기",
    description: "페이지 제목이나 아이콘(이모지)을 바꿉니다.",
    inputSchema: { page_id: z.string().uuid(), title: z.string().optional(), icon: z.string().max(8).optional() },
  }, guard(async ({ page_id, title, icon }: { page_id: string; title?: string; icon?: string }) => {
    if (title == null && icon == null) return fail("title이나 icon 중 하나는 주세요.");
    await rpc("mcp_save_page", { p_page: page_id, p_title: title ?? null, p_icon: icon ?? null });
    return text("바꿨습니다.");
  }));

  server.registerTool("query_database", {
    title: "데이터베이스 보기",
    description: "데이터베이스의 속성 정의(이름·종류·선택지)와 항목 목록(속성 값 포함)을 보여줍니다.",
    inputSchema: { database_id: z.string().uuid() },
    annotations: { readOnlyHint: true },
  }, guard(async ({ database_id }: { database_id: string }) => {
    const db = await getPage(database_id);
    if (db.kind !== "database" || !db.db_schema) return fail("데이터베이스가 아닙니다.");
    const rows = await rpc<{ id: string; title: string; properties: Record<string, PropValue> }[]>("mcp_list_rows", { p_database: database_id });
    const schema = db.db_schema;
    const lines = [`# ${db.icon ?? "🗃️"} ${db.title}`, "", "속성:"];
    for (const p of schema.properties) {
      lines.push(`- ${p.name} (${p.type})${p.options?.length ? `: ${p.options.map((o) => o.name).join(" / ")}` : ""}`);
    }
    lines.push("", `항목 ${rows.length}개:`);
    for (const r of rows) {
      const vals = schema.properties
        .map((p) => [p.name, readValue(p, r.properties[p.id], db.members)] as const)
        .filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
      lines.push(`- ${r.title || "제목 없음"}${vals.length ? ` — ${vals.join(" · ")}` : ""} id=${r.id}`);
    }
    return text(lines.join("\n"));
  }));

  server.registerTool("add_database_row", {
    title: "데이터베이스 항목 추가",
    description: "데이터베이스에 항목을 추가합니다. properties는 {속성 이름: 값}. 선택/상태는 선택지 이름(없으면 새로 만듦), 다중 선택은 이름 배열, 사람은 멤버 이름이나 이메일.",
    inputSchema: {
      database_id: z.string().uuid(),
      title: z.string().min(1),
      properties: z.record(z.string(), z.any()).optional(),
      markdown: z.string().optional(),
    },
  }, guard(async ({ database_id, title, properties, markdown }: { database_id: string; title: string; properties?: Record<string, unknown>; markdown?: string }) => {
    const db = await getPage(database_id);
    if (db.kind !== "database" || !db.db_schema) return fail("데이터베이스가 아닙니다.");
    const schema: DbSchema = JSON.parse(JSON.stringify(db.db_schema));
    const { props, changed } = toStored(schema, properties ?? {}, db.members);
    if (changed) await rpc("mcp_save_page", { p_page: database_id, p_db_schema: schema });
    const doc = new Y.Doc();
    await applyBlocks(doc, markdown ? await markdownToBlocks(markdown) : []);
    const id = await rpc<string>("mcp_create_page", {
      p_workspace: db.workspace_id, p_parent: database_id, p_kind: "row", p_title: title, p_icon: null,
      p_content: blocksOf(doc), p_properties: Object.fromEntries(Object.entries(props).filter(([, v]) => v != null)), p_db_schema: null,
    });
    if (markdown) await rpc("mcp_save_page", { p_page: id, p_ydoc: encodeDoc(doc) });
    return text(`추가했습니다: ${title} id=${id}${changed ? " (새 선택지를 만들었습니다)" : ""}`);
  }));

  server.registerTool("update_database_row", {
    title: "데이터베이스 항목 수정",
    description: "항목의 제목이나 속성을 바꿉니다. properties는 {속성 이름: 값}이고, 값을 null로 주면 비웁니다. 본문은 edit_page/update_page로 고칩니다.",
    inputSchema: { row_id: z.string().uuid(), title: z.string().optional(), properties: z.record(z.string(), z.any()).optional() },
  }, guard(async ({ row_id, title, properties }: { row_id: string; title?: string; properties?: Record<string, unknown> }) => {
    const row = await getPage(row_id);
    if (row.kind !== "row" || !row.parent_schema || !row.parent_id) return fail("데이터베이스 항목이 아닙니다.");
    if (properties && Object.keys(properties).length) {
      const schema: DbSchema = JSON.parse(JSON.stringify(row.parent_schema));
      const { props, changed } = toStored(schema, properties, row.members);
      if (changed) await rpc("mcp_save_page", { p_page: row.parent_id, p_db_schema: schema });
      await rpc("mcp_set_row_properties", { p_row: row_id, p_props: props });
    }
    if (title != null) await rpc("mcp_save_page", { p_page: row_id, p_title: title });
    return text("수정했습니다.");
  }));

  server.registerTool("list_versions", {
    title: "버전 기록 보기",
    description: "페이지의 버전 맵(커밋)을 최신순으로 보여줍니다: 메인/사용자 브랜치, 종류, 작성자(🤖는 AI 커밋). 내가 MCP로 고친 내용도 각각 하나의 커밋으로 남습니다.",
    inputSchema: { page_id: z.string().uuid() },
    annotations: { readOnlyHint: true },
  }, guard(async ({ page_id }: { page_id: string }) => {
    const vs = await rpc<{ id: string; created_at: string; source: string; label: string | null; title: string; edited_by: string | null; actor: string; actor_name: string | null; branch: string | null; branch_owner: string | null }[]>(
      "mcp_list_versions", { p_page: page_id });
    if (!vs.length) return text("저장된 버전이 없습니다.");
    const src: Record<string, string> = { auto: "자동 저장", manual: "직접 저장", tidy: "AI 정리 전", mcp: "AI 커밋", restore: "복원", commit: "커밋", merge: "머지", fork: "포크" };
    return text(vs.map((v) => {
      const lane = v.branch ? `[${v.branch_owner ?? "?"} / ${v.branch}]` : "[메인]";
      const who = v.actor === "ai" ? `🤖 ${v.actor_name ?? "AI"}` : v.edited_by ?? "알 수 없음";
      return `- ${new Date(v.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} ${lane} · ${src[v.source] ?? v.source}${v.label ? ` · ${v.label}` : ""} · ${who} id=${v.id}`;
    }).join("\n"));
  }));

  server.registerTool("read_version", {
    title: "버전 내용 보기",
    description: "특정 버전의 제목과 본문(Markdown)을 보여줍니다.",
    inputSchema: { version_id: z.string().uuid() },
    annotations: { readOnlyHint: true },
  }, guard(async ({ version_id }: { version_id: string }) => {
    const v = await rpc<{ title: string; content: AnyBlock[]; created_at: string }>("mcp_get_version", { p_version: version_id });
    return text([`# ${v.title || "제목 없음"} (${new Date(v.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 버전)`, "", await blocksToMarkdown(v.content ?? [])].join("\n"));
  }));

  server.registerTool("restore_version", {
    title: "버전 복원",
    description: "페이지를 지정한 버전의 내용(과 제목)으로 되돌립니다. 지금 상태는 '복원 전' 버전으로 남아 다시 되돌릴 수 있습니다.",
    inputSchema: { version_id: z.string().uuid() },
  }, guard(async ({ version_id }: { version_id: string }) => {
    const v = await rpc<{ page_id: string; title: string; content: AnyBlock[]; created_at?: string }>("mcp_get_version", { p_version: version_id });
    const p = await getPage(v.page_id);
    const s = await writeBody(p, v.content ?? [], `버전 복원 (${new Date(v.created_at ?? Date.now()).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })})`, "restore");
    if (v.title !== p.title) await rpc("mcp_save_page", { p_page: p.id, p_title: v.title });
    return text(`복원했습니다: 블록 ${s.removed}개 → ${s.added}개 교체${v.title !== p.title ? ", 제목도 되돌림" : ""}. ${pageUrl(p)}`);
  }));

  server.registerTool("add_comment", {
    title: "댓글 달기",
    description: "페이지에 댓글을 답니다. 문서를 직접 고치기보다 의견을 남기는 게 나을 때 쓰세요.",
    inputSchema: { page_id: z.string().uuid(), text: z.string().min(1).max(5000) },
  }, guard(async ({ page_id, text: body }: { page_id: string; text: string }) => {
    await rpc("mcp_add_comment", { p_page: page_id, p_body: body });
    return text("댓글을 달았습니다.");
  }));

  return server;
}
