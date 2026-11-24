import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplatePage } from "@/lib/templates";
import { PAGE_META_COLUMNS, type PageMeta, type PageKind, type DbSchema } from "@/lib/types";

export async function createPage(
  sb: SupabaseClient,
  opts: {
    workspaceId: string;
    userId: string;
    parentId?: string | null;
    kind?: PageKind;
    title?: string;
    icon?: string | null;
    cover?: string | null;
    content?: unknown[];
    schema?: DbSchema | null;
    properties?: Record<string, unknown>;
    position?: number;
  },
): Promise<PageMeta> {
  const { data, error } = await sb
    .from("pages")
    .insert({
      workspace_id: opts.workspaceId,
      parent_id: opts.parentId ?? null,
      kind: opts.kind ?? "doc",
      title: opts.title ?? "",
      icon: opts.icon ?? null,
      cover: opts.cover ?? null,
      content: opts.content ?? [],
      db_schema: opts.schema ?? null,
      properties: opts.properties ?? {},
      position: opts.position ?? Date.now() / 1000,
      created_by: opts.userId,
      updated_by: opts.userId,
    })
    .select(PAGE_META_COLUMNS)
    .single();
  if (error) throw error;
  return data as PageMeta;
}

/** Creates a template page (and its children / database rows). Returns the root page. */
export async function instantiateTemplate(
  sb: SupabaseClient,
  workspaceId: string,
  userId: string,
  parentId: string | null,
  tpl: TemplatePage,
): Promise<PageMeta> {
  const root = await createPage(sb, {
    workspaceId,
    userId,
    parentId,
    kind: tpl.kind,
    title: tpl.title,
    icon: tpl.icon,
    cover: tpl.cover ?? null,
    content: tpl.content ?? [],
    schema: tpl.schema ?? null,
  });

  if (tpl.kind === "database" && tpl.rows?.length) {
    const base = Date.now() / 1000;
    const { error } = await sb.from("pages").insert(
      tpl.rows.map((r, i) => ({
        workspace_id: workspaceId,
        parent_id: root.id,
        kind: "row",
        title: r.title,
        icon: r.icon ?? null,
        content: r.content ?? [],
        properties: r.properties,
        position: base + i,
        created_by: userId,
        updated_by: userId,
      })),
    );
    if (error) throw error;
  }

  for (const [i, child] of (tpl.children ?? []).entries()) {
    await instantiateTemplate(sb, workspaceId, userId, root.id, child);
    void i;
  }
  return root;
}

export async function setArchived(sb: SupabaseClient, pageId: string, archived: boolean) {
  const { error } = await sb.rpc("set_page_archived", { p_page: pageId, p_archived: archived });
  if (error) throw error;
}

export async function deleteForever(sb: SupabaseClient, pageId: string) {
  const { error } = await sb.from("pages").delete().eq("id", pageId);
  if (error) throw error;
}

export async function uploadFile(sb: SupabaseClient, workspaceId: string, file: File) {
  const ext = file.name.split(".").pop() || "bin";
  const path = `${workspaceId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from("uploads").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return sb.storage.from("uploads").getPublicUrl(path).data.publicUrl;
}
