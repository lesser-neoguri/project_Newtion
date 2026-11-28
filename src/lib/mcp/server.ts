import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { DbProperty, DbSchema, OptionColor, PropValue } from "@/lib/types";
import {
  applyBlocks, blocksOf, blocksToMarkdown, docFromStored, encodeDoc, markdownToBlocks, withLiveDoc, type AnyBlock,
} from "./docs";
import * as Y from "yjs";
import { fromB64 } from "@/lib/yjs-supabase";
import { BLOCK_HELP } from "@/lib/blocks/shared";

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
  /** Merge whatever was saved meanwhile (e.g. by an open tab) so the save below can't drop it. */
  async function mergeStored(pageId: string, doc: Y.Doc) {
    const fresh = await getPage(pageId);
    if (fresh.ydoc) Y.applyUpdate(doc, fromB64(fresh.ydoc));
  }

  async function writeBody(p: PageData, blocks: AnyBlock[], message: string, source: "mcp" | "restore" = "mcp") {
    if (p.role === "viewer") throw new ToolError("no permission");
    if (p.kind === "database") throw new ToolError("데이터베이스 페이지에는 본문이 없습니다. 항목은 add_database_row로 추가하세요.");
    const doc = docFromStored(p.ydoc, p.content);
    const stats = await withLiveDoc(p.id, doc, (d) => applyBlocks(d, blocks));
    await mergeStored(p.id, doc);
    const after = blocksOf(doc);
    await rpc("mcp_save_page", { p_page: p.id, p_content: after, p_ydoc: encodeDoc(doc) });
    if (stats.changed) {
      await rpc("mcp_create_version", { p_page: p.id, p_title: p.title, p_content: after, p_source: source, p_label: message.slice(0, 120) });
    }
    return stats;
  }

  /** Edit the body from its live state (open tabs included): transform the current blocks. */
  async function editBody(p: PageData, transform: (blocks: AnyBlock[]) => AnyBlock[] | Promise<AnyBlock[]>, message: string) {
    if (p.role === "viewer") throw new ToolError("no permission");
    const doc = docFromStored(p.ydoc, p.content);
    const stats = await withLiveDoc(p.id, doc, async (d) => applyBlocks(d, await transform(blocksOf(d))));
    await mergeStored(p.id, doc);
    const after = blocksOf(doc);
    await rpc("mcp_save_page", { p_page: p.id, p_content: after, p_ydoc: encodeDoc(doc) });
    if (stats.changed) {
      await rpc("mcp_create_version", { p_page: p.id, p_title: p.title, p_content: after, p_source: "mcp", p_label: message.slice(0, 120) });
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
        "수정은 열려 있는 편집기에 실시간으로 반영되고, 바뀐 블록만 교체되어 다른 블록의 서식은 유지됩니다. " +
        "웹 게임(SDL2·Emscripten 빌드)은 기획서 페이지 옆에서 실행됩니다. 새 빌드 배포: list_games → start_game_upload → " +
        "돌려준 bash 스크립트 실행 → publish_game_build. 빌드 파일 내용을 도구 인자로 보내지 마세요. " +
        "스프라이트 도감의 모듈 GIF는 list_sprites → start_sprite_upload → 스크립트 실행 → set_sprites로 넣습니다. " +
        "본문의 \`\`\`newtion-(종류) 코드 블록은 특수 블록의 JSON 데이터입니다. 관계없으면 그대로 두고, 같은 형식으로 새로 써서 특수 블록을 만들 수도 있습니다: " +
        Object.entries(BLOCK_HELP).map(([k, v]) => `newtion-${k} = ${v}`).join(" / "),
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

  /* ---------------------------------------------------------------- */
  /* Sprite gallery (모듈 도감 등): GIF per item                        */
  /* ---------------------------------------------------------------- */

  type SpriteItem = { id: string; name: string; tag?: string; desc?: string; note?: string; gif?: string; w?: number; h?: number };
  const galleries = (blocks: AnyBlock[]) => blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.type === "spriteGallery");
  const itemsOf = (b: AnyBlock): SpriteItem[] => { try { return JSON.parse(b.props?.data || "{}").items ?? []; } catch { return []; } };
  const norm = (s: string) => s.toLowerCase().replace(/[\s·()（）\[\]{}_\-.,/]+/g, "");
  const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const pathUrl = (path: string) => `${SUPA}/storage/v1/object/public/uploads/${path.split("/").map(encodeURIComponent).join("/")}`;

  server.registerTool("list_sprites", {
    title: "스프라이트 목록 보기",
    description: "페이지의 스프라이트 도감 블록(모듈별 이미지 목록)과 각 항목의 이름·분류·GIF 유무를 봅니다. set_sprites로 GIF를 넣기 전에 이름을 확인하세요.",
    inputSchema: { page_id: z.string().uuid(), missing_only: z.boolean().optional().describe("GIF가 아직 없는 항목만") },
  }, guard(async ({ page_id, missing_only }: { page_id: string; missing_only?: boolean }) => {
    const p = await getPage(page_id);
    const doc = docFromStored(p.ydoc, p.content);
    const gs = galleries(blocksOf(doc));
    if (!gs.length) return text("이 페이지에는 스프라이트 도감 블록이 없습니다. 본문에 ```newtion-spriteGallery 블록을 추가하거나 사용자에게 /스프라이트 도감 을 넣어 달라고 하세요.");
    const lines: string[] = [];
    let total = 0, done = 0;
    gs.forEach(({ b }, gi) => {
      const items = itemsOf(b);
      total += items.length; done += items.filter((x) => x.gif).length;
      lines.push(`## 목록 ${gi + 1}${items[0]?.tag ? ` · ${items[0].tag}` : ""} (${items.filter((x) => x.gif).length}/${items.length})`);
      for (const it of items) if (!missing_only || !it.gif) lines.push(`- ${it.name}${it.gif ? " ✅" : " ⬜"}  (id: ${it.id})`);
    });
    return text(`${p.title}: GIF ${done}/${total}\n\n${lines.join("\n")}`);
  }));

  server.registerTool("start_sprite_upload", {
    title: "스프라이트 파일 업로드 시작",
    description:
      "스프라이트 GIF(또는 스프라이트 시트 PNG)를 올리기 위한 업로드 티켓과 bash 스크립트를 받습니다. 스크립트를 셸에서 실행해 폴더의 파일을 올린 뒤(2시간 안에), " +
      "set_sprites로 각 파일을 모듈에 연결하세요. 파일 내용을 도구 인자로 보내지 마세요. 파일 이름은 영문·숫자를 권장합니다.",
    inputSchema: {
      page_id: z.string().uuid(),
      dir: z.string().max(500).optional().describe("올릴 파일이 있는 폴더 (기본 ./sprites). .gif .png .webp만 올립니다"),
    },
  }, guard(async ({ page_id, dir }: { page_id: string; dir?: string }) => {
    const t = await rpc<{ ticket: string; prefix: string }>("mcp_create_upload_ticket", { p_page: page_id });
    const d = (dir ?? "./sprites").replace(/'/g, "'\\''");
    const script = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `cd '${d}'`,
      `U='${SUPA}/storage/v1/object/uploads/${t.prefix}'`,
      `K='${KEY}'  # 공개(publishable) 키. 이 티켓 경로에만 2시간 동안 올릴 수 있음`,
      "for f in *.gif *.png *.webp *.GIF *.PNG; do",
      "  [ -f \"$f\" ] || continue",
      "  case \"$f\" in *.gif|*.GIF) t=image/gif;; *.png|*.PNG) t=image/png;; *) t=image/webp;; esac",
      "  enc=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' \"$f\")",
      "  curl -sS --fail-with-body -X POST \"$U/$enc\" -H \"apikey: $K\" -H \"Authorization: Bearer $K\" -H \"Content-Type: $t\" --data-binary \"@$f\" > /dev/null",
      "  echo \"uploaded $f\"",
      "done",
    ].join("\n");
    return text(
      `업로드 티켓: ${t.ticket}\n\n아래 스크립트로 파일을 올리세요 (네트워크에서 ${new URL(SUPA).host} 접근 필요):\n\n\`\`\`bash\n${script}\n\`\`\`\n\n` +
      `그다음 set_sprites(page_id, ticket: "${t.ticket}", sprites: [{ module: "모듈 이름", file: "올린 파일 이름" }, ...])를 호출하세요. ` +
      `PNG 스프라이트 시트는 sheet: { fw, fh, fps, frames?, scale?, pingpong? }를 주면 서버에서 GIF로 바꿔 넣습니다.`);
  }));

  server.registerTool("set_sprites", {
    title: "모듈에 스프라이트 GIF 넣기",
    description:
      "start_sprite_upload로 올린 파일을 스프라이트 도감의 항목(모듈)에 연결합니다. 여러 개를 한 번에 넣을 수 있습니다. " +
      "module은 항목 이름(공백·기호 무시) 또는 id. GIF는 그대로, PNG 스프라이트 시트는 sheet 설정으로 서버에서 GIF로 변환합니다. 열려 있는 탭에 바로 반영되고 버전 기록에 남습니다.",
    inputSchema: {
      page_id: z.string().uuid(),
      ticket: z.string().uuid(),
      sprites: z.array(z.object({
        module: z.string().min(1).describe("항목 이름 또는 id"),
        file: z.string().min(1).describe("업로드한 파일 이름 (예: diesel_engine.gif)"),
        sheet: z.object({
          fw: z.number().int().positive().optional(), fh: z.number().int().positive().optional(),
          frames: z.number().int().min(0).optional(), start: z.number().int().min(0).optional(),
          fps: z.number().positive().max(60).optional(), scale: z.number().int().min(1).max(8).optional(), pingpong: z.boolean().optional(),
        }).optional().describe("PNG 스프라이트 시트일 때 프레임 설정 (fw·fh 생략 시 가로 한 줄의 정사각형 프레임으로 추정)"),
      })).min(1).max(200),
    },
  }, guard(async ({ page_id, ticket, sprites }: { page_id: string; ticket: string; sprites: { module: string; file: string; sheet?: Record<string, number | boolean> }[] }) => {
    const p = await getPage(page_id);
    const prefix = `${p.workspace_id}/t-${ticket}`;
    const { pngSheetToGif, gifSize } = await import("@/lib/gif-node");

    // Resolve every file first (download, convert sheets), then edit the page once.
    const ready: { module: string; url: string; w?: number; h?: number }[] = [];
    const problems: string[] = [];
    for (const s of sprites) {
      const path = `${prefix}/${s.file}`;
      const res = await fetch(pathUrl(path));
      if (!res.ok) { problems.push(`${s.module}: '${s.file}' 파일을 찾을 수 없어요 (업로드 스크립트를 실행했는지, 파일 이름이 맞는지 확인)`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const size = gifSize(buf);
      if (size) { ready.push({ module: s.module, url: pathUrl(path), w: size.width, h: size.height }); continue; }
      if (buf.subarray(1, 4).toString() !== "PNG") { problems.push(`${s.module}: GIF나 PNG가 아니에요`); continue; }
      try {
        const g = pngSheetToGif(buf, (s.sheet ?? {}) as never);
        const out = `${prefix}/gif-${Date.now().toString(36)}-${s.file.replace(/\.[^.]+$/, "")}.gif`;
        const { error } = await sb.storage.from("uploads").upload(out, Buffer.from(g.gif), { contentType: "image/gif", cacheControl: "31536000" });
        if (error) throw error;
        ready.push({ module: s.module, url: pathUrl(out), w: g.width, h: g.height });
      } catch (e) { problems.push(`${s.module}: GIF 변환 실패 (${(e as Error).message})`); }
    }

    const matched: string[] = [];
    const unmatched = new Set(ready.map((r) => r.module));
    if (ready.length) {
      await editBody(p, (blocks) => blocks.map((b) => {
        if (b.type !== "spriteGallery") return b;
        let data: { items?: SpriteItem[] } & Record<string, unknown>;
        try { data = JSON.parse(b.props?.data || "{}"); } catch { return b; }
        let changed = false;
        const items = (data.items ?? []).map((it) => {
          const hit = ready.find((r) => r.module === it.id) ?? ready.find((r) => norm(r.module) === norm(it.name));
          if (!hit) return it;
          changed = true;
          unmatched.delete(hit.module);
          matched.push(it.name);
          return { ...it, gif: hit.url, w: hit.w, h: hit.h };
        });
        return changed ? { ...b, props: { ...b.props, data: JSON.stringify({ ...data, items }) } } : b;
      }), `스프라이트 GIF ${ready.length}개 넣기`);
    }
    for (const m of unmatched) problems.push(`${m}: 같은 이름의 항목이 없어요 (list_sprites로 이름 확인)`);
    return text(`넣었습니다: ${matched.length}개${matched.length ? ` (${matched.slice(0, 20).join(", ")}${matched.length > 20 ? " …" : ""})` : ""}` +
      (problems.length ? `\n\n확인 필요:\n- ${problems.join("\n- ")}` : "") + `\n${pageUrl(p)}`);
  }));

  /* ---------------------------------------------------------------- */
  /* Web game builds (SDL2 / Emscripten)                              */
  /* ---------------------------------------------------------------- */

  type GameRow = { id: string; name: string; workspace: string; latest_version: string | null; latest_build_id: string | null; builds: number; pages: { id: string; title: string }[] };
  const playUrl = (buildId: string, entry = "index.html") => `${APP_URL}/g/${buildId}/${entry}`;

  server.registerTool("list_games", {
    title: "게임 목록",
    description: "워크스페이스의 웹 게임(SDL2·Emscripten 빌드)과 최신 버전, 연결된 기획서 페이지를 봅니다.",
    inputSchema: { workspace_id: z.string().uuid().optional() },
  }, guard(async ({ workspace_id }: { workspace_id?: string }) => {
    const games = await rpc<GameRow[]>("mcp_list_games", { p_workspace: workspace_id ?? null });
    if (!games.length) return text("게임이 없습니다. create_game으로 만드세요.");
    return text(games.map((g) =>
      `- ${g.name} (game_id: ${g.id}) · ${g.workspace} · 최신 ${g.latest_version ?? "없음"} · 버전 ${g.builds}개` +
      (g.pages.length ? `\n  기획서: ${g.pages.map((p) => `${p.title || "제목 없음"} (${p.id})`).join(", ")}` : "") +
      (g.latest_build_id ? `\n  실행: ${playUrl(g.latest_build_id)}` : "")).join("\n"));
  }));

  server.registerTool("create_game", {
    title: "게임 만들기",
    description: "웹 게임을 만듭니다. page_id를 주면 그 기획서 페이지 옆에 게임이 붙어서 문서와 게임을 같이 볼 수 있습니다.",
    inputSchema: {
      workspace_id: z.string().uuid(),
      name: z.string().min(1).max(80),
      description: z.string().max(2000).optional(),
      page_id: z.string().uuid().optional().describe("게임을 붙일 기획서 페이지"),
    },
  }, guard(async ({ workspace_id, name, description, page_id }: { workspace_id: string; name: string; description?: string; page_id?: string }) => {
    const g = await rpc<{ id: string; name: string }>("mcp_create_game", { p_workspace: workspace_id, p_name: name, p_description: description ?? null, p_page: page_id ?? null });
    return text(`게임을 만들었습니다: ${g.name} (game_id: ${g.id})${page_id ? ` · 페이지에 연결됨 ${APP_URL}/w/${workspace_id}/p/${page_id}` : ""}\n다음: start_game_upload로 첫 버전을 올리세요.`);
  }));

  server.registerTool("link_game", {
    title: "페이지에 게임 연결",
    description: "기획서 페이지 옆에 보여줄 게임을 바꿉니다. game_id를 빼면 연결을 끊습니다.",
    inputSchema: { page_id: z.string().uuid(), game_id: z.string().uuid().optional() },
  }, guard(async ({ page_id, game_id }: { page_id: string; game_id?: string }) => {
    await rpc("mcp_link_game", { p_page: page_id, p_game: game_id ?? null });
    return text(game_id ? "페이지에 게임을 연결했습니다." : "연결을 끊었습니다.");
  }));

  server.registerTool("list_game_builds", {
    title: "게임 버전 목록",
    description: "게임에 올라간 버전(빌드)들을 최신순으로 봅니다.",
    inputSchema: { game_id: z.string().uuid() },
  }, guard(async ({ game_id }: { game_id: string }) => {
    type B = { id: string; version: string; notes: string | null; status: string; entry: string; files: number; total_size: number; created_at: string; by: string; latest: boolean };
    const bs = await rpc<B[]>("mcp_list_game_builds", { p_game: game_id });
    if (!bs.length) return text("아직 버전이 없습니다.");
    return text(bs.map((b) =>
      `- ${b.version}${b.latest ? " [최신]" : ""}${b.status !== "ready" ? " (업로드 중·미게시)" : ""} · ${b.by} · ${new Date(b.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` +
      ` · 파일 ${b.files}개 ${(b.total_size / 1048576).toFixed(1)}MB (build_id: ${b.id})` +
      (b.notes ? `\n  ${b.notes}` : "") + (b.status === "ready" ? `\n  실행: ${playUrl(b.id, b.entry)}` : "")).join("\n"));
  }));

  server.registerTool("start_game_upload", {
    title: "게임 새 버전 업로드 시작",
    description:
      "웹 게임의 새 버전(Emscripten 빌드 결과물 폴더: .html, .js, .wasm, .data, 에셋)을 올립니다. " +
      "1) 이 도구로 버전을 만들면 업로드용 bash 스크립트가 나옵니다. 2) 셸에서 그 스크립트를 그대로 실행해 파일을 올립니다(2시간 안에). " +
      "3) publish_game_build로 게시하면 최신 버전이 되고 기획서 옆 뷰어에 바로 뜹니다. 파일 내용을 도구 인자로 보내지 마세요.",
    inputSchema: {
      game_id: z.string().uuid(),
      version: z.string().min(1).max(60).describe("예: v0.3, 2026-11-26-boss"),
      notes: z.string().max(2000).optional().describe("이번 버전 변경 사항"),
      build_dir: z.string().max(500).optional().describe("올릴 빌드 폴더 경로 (스크립트에 그대로 들어감, 기본값 ./build)"),
      entry: z.string().max(200).optional().describe("시작 HTML (기본 index.html)"),
    },
  }, guard(async ({ game_id, version, notes, build_dir, entry }: { game_id: string; version: string; notes?: string; build_dir?: string; entry?: string }) => {
    const b = await rpc<{ build_id: string }>("mcp_start_game_build", { p_game: game_id, p_version: version, p_notes: notes ?? null, p_entry: entry ?? null });
    const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/games/${b.build_id}`;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const dir = (build_dir ?? "./build").replace(/'/g, "'\\''");
    const script = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `cd '${dir}'`,
      `U='${base}'`,
      `K='${key}'  # 공개(publishable) 키. 업로드 권한은 이 build_id가 2시간 동안만 가짐`,
      "find . -type f ! -name '.DS_Store' ! -path '*/.git/*' | sed 's|^\\./||' | while IFS= read -r f; do",
      "  case \"$f\" in",
      "    *.html|*.htm) t=text/html;; *.js|*.mjs) t=text/javascript;; *.wasm) t=application/wasm;;",
      "    *.json|*.map) t=application/json;; *.css) t=text/css;; *.png) t=image/png;; *.jpg|*.jpeg) t=image/jpeg;;",
      "    *.ogg) t=audio/ogg;; *.mp3) t=audio/mpeg;; *.wav) t=audio/wav;; *.ttf) t=font/ttf;; *) t=application/octet-stream;;",
      "  esac",
      "  enc=$(printf '%s' \"$f\" | sed 's/%/%25/g; s/ /%20/g; s/#/%23/g; s/?/%3F/g')",
      "  curl -sS --fail-with-body -X POST \"$U/$enc\" -H \"apikey: $K\" -H \"Authorization: Bearer $K\" \\",
      "    -H \"Content-Type: $t\" -H 'Cache-Control: max-age=31536000' --data-binary \"@$f\" > /dev/null",
      "  echo \"uploaded $f\"",
      "done",
    ].join("\n");
    return text(
      `버전을 만들었습니다: ${version} (build_id: ${b.build_id})\n\n` +
      `아래 스크립트를 셸에서 실행해 빌드 파일을 올리세요 (네트워크에서 ${new URL(base).host} 접근이 필요합니다):\n\n\`\`\`bash\n${script}\n\`\`\`\n\n` +
      `다 올라가면 publish_game_build(build_id: "${b.build_id}")를 호출하세요.`);
  }));

  server.registerTool("publish_game_build", {
    title: "게임 버전 게시",
    description: "start_game_upload로 올린 파일을 확인하고 게시합니다. 게시하면 이 버전이 최신이 되어 기획서 옆 뷰어에 바로 뜹니다.",
    inputSchema: { build_id: z.string().uuid(), entry: z.string().max(200).optional().describe("시작 HTML이 index.html이 아니면 지정") },
  }, guard(async ({ build_id, entry }: { build_id: string; entry?: string }) => {
    const r = await rpc<{ version: string; entry: string; files: number; total_size: number }>("mcp_publish_game_build", { p_build: build_id, p_entry: entry ?? null });
    return text(`게시했습니다: ${r.version} · 파일 ${r.files}개 ${(r.total_size / 1048576).toFixed(1)}MB\n실행: ${playUrl(build_id, r.entry)}`);
  }));

  return server;
}
