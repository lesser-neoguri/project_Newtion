/**
 * Server-side document editing for the MCP endpoint.
 *
 * Edits are applied to the page's Yjs document like a collaborator would:
 * the server joins the page's realtime channel, syncs the latest state from
 * any open tabs, replaces only the top-level blocks whose content changed,
 * broadcasts that update (open tabs see it live) and saves the result.
 */
import * as Y from "yjs";
import { createClient } from "@supabase/supabase-js";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { getDocument } from "@blocknote/server-util/dom";
import { SupabaseYProvider, fromB64, toB64 } from "@/lib/yjs-supabase";

export const FRAGMENT = "document-store";

type Editor = ReturnType<typeof ServerBlockNoteEditor.create>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyBlock = any;

let editor: Editor | null = null;
function ed(): Editor {
  if (!editor) editor = ServerBlockNoteEditor.create({}, getDocument());
  return editor;
}

export async function markdownToBlocks(md: string): Promise<AnyBlock[]> {
  return ed().tryParseMarkdownToBlocks(md);
}

export async function blocksToMarkdown(blocks: AnyBlock[]): Promise<string> {
  if (!blocks.length) return "";
  return (await ed().blocksToMarkdownLossy(blocks)).trimEnd();
}

/** Builds the page's Y.Doc from its stored state (or its JSON content for pages never opened in the editor). */
export function docFromStored(ydoc: string | null, content: AnyBlock[] | null): Y.Doc {
  const doc = new Y.Doc();
  if (ydoc) Y.applyUpdate(doc, fromB64(ydoc));
  else if (content?.length) ed().blocksToYXmlFragment(content, doc.getXmlFragment(FRAGMENT));
  return doc;
}

export function blocksOf(doc: Y.Doc): AnyBlock[] {
  const frag = doc.getXmlFragment(FRAGMENT);
  return frag.length ? ed().yXmlFragmentToBlocks(frag) : [];
}

export function encodeDoc(doc: Y.Doc): string {
  return toB64(Y.encodeStateAsUpdate(doc));
}

/** Replaces the document's top-level blocks with `newBlocks`, touching only blocks whose content differs. */
export async function applyBlocks(doc: Y.Doc, newBlocks: AnyBlock[]) {
  const frag = doc.getXmlFragment(FRAGMENT);
  const oldBlocks = blocksOf(doc);
  const oldMd = await Promise.all(oldBlocks.map((b) => blocksToMarkdown([b])));
  const newMd = await Promise.all(newBlocks.map((b) => blocksToMarkdown([b])));

  // New blocks as Yjs elements (built in a scratch doc, cloned into the live one).
  const scratch = new Y.Doc();
  const sf = scratch.getXmlFragment("x");
  if (newBlocks.length) ed().blocksToYXmlFragment(newBlocks, sf);
  const newEls = sf.length ? ((sf.get(0) as Y.XmlElement).toArray() as Y.XmlElement[]) : [];

  // Longest common subsequence over per-block Markdown → hunks of (delete old range, insert new blocks).
  const n = oldMd.length, m = newMd.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = oldMd[i] === newMd[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks: { at: number; del: number; ins: number[] }[] = [];
  let i = 0, j = 0;
  let cur: { at: number; del: number; ins: number[] } | null = null;
  while (i < n || j < m) {
    if (i < n && j < m && oldMd[i] === newMd[j]) {
      if (cur) { hunks.push(cur); cur = null; }
      i++; j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      cur ??= { at: i, del: 0, ins: [] };
      cur.ins.push(j++);
    } else {
      cur ??= { at: i, del: 0, ins: [] };
      cur.del++; i++;
    }
  }
  if (cur) hunks.push(cur);
  if (!hunks.length) return { changed: 0, added: 0, removed: 0 };

  doc.transact(() => {
    let group = frag.length ? (frag.get(0) as Y.XmlElement) : null;
    if (!group) {
      group = new Y.XmlElement("blockGroup");
      frag.insert(0, [group]);
    }
    // Apply from the end so earlier indices stay valid.
    for (const h of [...hunks].reverse()) {
      if (h.del) group.delete(h.at, h.del);
      if (h.ins.length) group.insert(h.at, h.ins.map((k) => newEls[k].clone()));
    }
  }, "mcp");

  return {
    changed: hunks.length,
    added: hunks.reduce((s, h) => s + h.ins.length, 0),
    removed: hunks.reduce((s, h) => s + h.del, 0),
  };
}

/**
 * Opens the page as a live collaborator: syncs with open tabs, runs `edit`,
 * broadcasts the resulting update, then disconnects.
 */
export async function withLiveDoc<T>(pageId: string, doc: Y.Doc, edit: (doc: Y.Doc) => Promise<T>): Promise<T> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const provider = new SupabaseYProvider(sb, pageId, doc);
  provider.awareness.setLocalStateField("user", { name: "Claude", color: "#d97757" });
  try {
    // Wait for open tabs to send their latest state (or ~1s if nobody is there).
    await new Promise<void>((resolve) => {
      provider.onSynced(resolve);
      setTimeout(resolve, 4000);
    });
    const result = await edit(doc);
    await new Promise((r) => setTimeout(r, 500)); // let the broadcast go out
    return result;
  } finally {
    provider.destroy();
    await sb.removeAllChannels();
  }
}
