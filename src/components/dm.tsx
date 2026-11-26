"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, X } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { Avatar } from "./ui";
import type { Profile } from "@/lib/types";

export interface InboxItem {
  conversation_id: string;
  other_id: string;
  last_message_at: string;
  last_body: string | null;
  last_sender: string | null;
  last_has_image: boolean;
  unread: number;
}

export interface DmAttachment { path: string; name: string; type: string; size: number; width?: number; height?: number }

export interface DmMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  attachments: DmAttachment[];
  created_at: string;
  deleted_at: string | null;
}

interface DmCtx {
  inbox: InboxItem[];
  unread: number;
  profiles: Map<string, Profile>;
  reload: () => Promise<void>;
  /** The conversation on screen (no toast, marked read as messages arrive). */
  setActive: (conversationId: string | null) => void;
}

const Ctx = createContext<DmCtx | null>(null);
export const useDm = () => useContext(Ctx)!;

export const previewText = (m: { body?: string | null; last_body?: string | null; last_has_image?: boolean; attachments?: unknown[] }) => {
  const body = (m.body ?? m.last_body ?? "").trim();
  const img = m.last_has_image || (m.attachments?.length ?? 0) > 0;
  return body ? body.replace(/\s+/g, " ") : img ? "📷 사진" : "";
};

/** Unread counts, new-message toasts and profiles of the people you talk to. */
export function DmProvider({ children }: { children: ReactNode }) {
  const { sb, me, workspace, memberMap } = useWorkspace();
  const router = useRouter();
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [extra, setExtra] = useState<Map<string, Profile>>(new Map());
  const [toast, setToast] = useState<{ msg: DmMessage; who: string } | null>(null);
  const active = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const { data } = await sb.rpc("dm_inbox");
    const list = (data ?? []) as InboxItem[];
    setInbox(list);
    // People from other workspaces aren't in memberMap: fetch their profiles once.
    const missing = list.map((i) => i.other_id).filter((id) => !memberMap.has(id) && !extra.has(id));
    if (missing.length) {
      const { data: ps } = await sb.from("profiles").select("id, email, display_name, avatar_color").in("id", missing);
      if (ps?.length) setExtra((m) => new Map([...m, ...ps.map((p) => [p.id, p as Profile] as const)]));
    }
  }, [sb, memberMap, extra]);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => { void reloadRef.current(); }, []);

  useEffect(() => {
    // RLS limits these events to conversations I'm in.
    const ch = sb
      .channel(`dm-inbox:${me.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages" }, (p) => {
        const msg = p.new as DmMessage;
        void reloadRef.current();
        if (msg.sender_id !== me.id && msg.conversation_id !== active.current) {
          const who = memberMap.get(msg.sender_id)?.display_name ?? extra.get(msg.sender_id)?.display_name ?? "새 메시지";
          setToast({ msg, who });
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_reads" }, () => void reloadRef.current())
      .subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [sb, me.id, memberMap, extra]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const profiles = useMemo(() => new Map([...extra, ...memberMap]), [extra, memberMap]);
  const unread = inbox.reduce((n, i) => n + Number(i.unread), 0);
  const setActive = useCallback((id: string | null) => { active.current = id; if (id) setToast(null); }, []);

  return (
    <Ctx.Provider value={{ inbox, unread, profiles, reload, setActive }}>
      {children}
      {toast && (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[97] w-[min(92vw,360px)] -translate-x-1/2 md:left-auto md:right-24 md:translate-x-0">
          <div className="flex items-start gap-2.5 rounded-xl border border-line bg-background p-3 shadow-xl">
            <button
              className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
              onClick={() => { setToast(null); router.push(`/w/${workspace.id}/messages?with=${toast.msg.sender_id}`); }}
            >
              <Avatar profile={profiles.get(toast.msg.sender_id)} size={28} />
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-sm font-medium"><MessageCircle size={13} className="text-muted" /> {toast.who}</span>
                <span className="line-clamp-2 text-sm text-muted">{previewText(toast.msg)}</span>
              </span>
            </button>
            <button onClick={() => setToast(null)} className="rounded p-0.5 text-muted hover:bg-hover"><X size={14} /></button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
