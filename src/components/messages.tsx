"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ImagePlus, MessageCircle, Send, Trash2, X } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { previewText, useDm, type DmAttachment, type DmMessage } from "./dm";
import { Avatar, Spinner } from "./ui";
import { shrinkImage } from "@/lib/api";
import type { Profile } from "@/lib/types";

const PAGE = 40;
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
const shortWhen = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? timeLabel(iso) : d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
};

/** Signed URLs for private DM images, cached for the session. */
function useSignedUrls(paths: string[]) {
  const { sb } = useWorkspace();
  const cache = useRef(new Map<string, string>());
  const [, bump] = useState(0);
  const key = paths.join("|");
  useEffect(() => {
    const missing = paths.filter((p) => !cache.current.has(p));
    if (!missing.length) return;
    void sb.storage.from("dm").createSignedUrls(missing, 3600).then(({ data }) => {
      for (const d of data ?? []) if (d.signedUrl && d.path) cache.current.set(d.path, d.signedUrl);
      bump((n) => n + 1);
    });
  }, [sb, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return cache.current;
}

export function Messages() {
  const { me, members } = useWorkspace();
  const { inbox, profiles } = useDm();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const withId = params.get("with");

  // Contacts: people I've talked to (most recent first), then other workspace members.
  const contacts = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; item?: (typeof inbox)[number] }[] = [];
    for (const i of inbox) if (!seen.has(i.other_id)) { seen.add(i.other_id); out.push({ id: i.other_id, item: i }); }
    for (const m of members) if (m.user_id !== me.id && !seen.has(m.user_id)) { seen.add(m.user_id); out.push({ id: m.user_id }); }
    return out;
  }, [inbox, members, me.id]);

  const open = (id: string | null) => router.push(id ? `${pathname}?with=${id}` : pathname);

  // The floating AI button would sit on the send button.
  useEffect(() => {
    document.body.dataset.dm = "1";
    return () => { delete document.body.dataset.dm; };
  }, []);

  return (
    <div className="flex h-full">
      <aside className={`${withId ? "hidden md:flex" : "flex"} w-full flex-col border-line md:w-80 md:shrink-0 md:border-r`}>
        <div className="flex h-11 shrink-0 items-center gap-2 pl-11 pr-3 font-semibold md:px-4">
          <MessageCircle size={16} /> 메시지
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-4">
          {contacts.length === 0 && (
            <p className="p-6 text-center text-sm text-muted">워크스페이스에 다른 멤버가 없어요. 설정에서 친구를 초대하면 메시지를 주고받을 수 있어요.</p>
          )}
          {contacts.map(({ id, item }) => {
            const p = profiles.get(id);
            return (
              <button
                key={id}
                onClick={() => open(id)}
                className={`flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-hover ${withId === id ? "bg-hover" : ""}`}
              >
                <Avatar profile={p} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{p?.display_name || p?.email || "알 수 없음"}</span>
                    {item && <span className="ml-auto shrink-0 text-[11px] text-muted">{shortWhen(item.last_message_at)}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`truncate text-xs ${item && Number(item.unread) > 0 ? "font-medium text-foreground" : "text-muted"}`}>
                      {item ? `${item.last_sender === me.id ? "나: " : ""}${previewText(item) || "보낸 메시지를 취소했어요"}` : "대화를 시작해 보세요"}
                    </span>
                    {item && Number(item.unread) > 0 && (
                      <span className="ml-auto shrink-0 rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-[18px] text-white">{item.unread}</span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className={`${withId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {withId ? (
          <Chat key={withId} otherId={withId} other={profiles.get(withId)} onBack={() => open(null)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted">
            <MessageCircle size={28} /> 대화할 사람을 고르세요
          </div>
        )}
      </section>
    </div>
  );
}

interface Pending { id: string; file: File; url: string }

function Chat({ otherId, other, onBack }: { otherId: string; other?: Profile; onBack: () => void }) {
  const { sb, me } = useWorkspace();
  const { setActive, reload } = useDm();
  const [conv, setConv] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<DmMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [otherRead, setOtherRead] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // keep scrolled to the bottom unless the user scrolled up
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const markRead = useCallback(async (c: string) => {
    await sb.rpc("dm_mark_read", { p_conv: c });
    void reload();
  }, [sb, reload]);

  // Open the conversation and load the latest messages.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: c, error: e } = await sb.rpc("dm_open", { p_other: otherId });
      if (!alive) return;
      if (e || !c) { setError(e?.message.includes("permission") ? "같은 워크스페이스에 있는 사람에게만 메시지를 보낼 수 있어요." : e?.message ?? "대화를 열 수 없어요."); return; }
      setConv(c as string);
      const [{ data: ms }, { data: reads }] = await Promise.all([
        sb.from("dm_messages").select("*").eq("conversation_id", c).order("created_at", { ascending: false }).limit(PAGE),
        sb.from("dm_reads").select("user_id, last_read_at").eq("conversation_id", c),
      ]);
      if (!alive) return;
      setMessages(((ms ?? []) as DmMessage[]).reverse());
      setHasMore((ms ?? []).length === PAGE);
      setOtherRead((reads ?? []).find((r) => r.user_id === otherId)?.last_read_at ?? null);
      void markRead(c as string);
    })();
    return () => { alive = false; };
  }, [sb, otherId, markRead]);

  // Live: new messages, unsends, read receipts.
  useEffect(() => {
    if (!conv) return;
    setActive(conv);
    const ch = sb
      .channel(`dm:${conv}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages", filter: `conversation_id=eq.${conv}` }, (p) => {
        const m = p.new as DmMessage;
        setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
        if (m.sender_id !== me.id && document.visibilityState === "visible") void markRead(conv);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "dm_messages", filter: `conversation_id=eq.${conv}` }, (p) => {
        const m = p.new as DmMessage;
        setMessages((prev) => prev?.map((x) => (x.id === m.id ? m : x)) ?? prev);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_reads", filter: `conversation_id=eq.${conv}` }, (p) => {
        const r = p.new as { user_id: string; last_read_at: string };
        if (r?.user_id === otherId) setOtherRead(r.last_read_at);
      })
      .subscribe();
    const onVisible = () => document.visibilityState === "visible" && void markRead(conv);
    document.addEventListener("visibilitychange", onVisible);
    return () => { setActive(null); void sb.removeChannel(ch); document.removeEventListener("visibilitychange", onVisible); };
  }, [sb, conv, me.id, otherId, setActive, markRead]);

  // Stay at the bottom as messages arrive (unless reading older ones).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    if (!conv || !messages?.length) return;
    const el = scroller.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    const { data } = await sb.from("dm_messages").select("*").eq("conversation_id", conv)
      .lt("created_at", messages[0].created_at).order("created_at", { ascending: false }).limit(PAGE);
    const older = ((data ?? []) as DmMessage[]).reverse();
    stick.current = false;
    setMessages((prev) => [...older, ...(prev ?? [])]);
    setHasMore(older.length === PAGE);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
  }

  const addFiles = (files: File[]) => {
    const imgs = files.filter((f) => /^image\/(png|jpeg|gif|webp|heic|heif)$/.test(f.type));
    if (imgs.length < files.length) setError("이미지(png · jpg · gif · webp)만 보낼 수 있어요.");
    setPending((p) => [...p, ...imgs.slice(0, Math.max(0, 10 - p.length)).map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))]);
  };
  useEffect(() => () => pending.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!conv || sending) return;
    const body = text.trim();
    if (!body && !pending.length) return;
    setSending(true);
    setError(null);
    try {
      const attachments: DmAttachment[] = [];
      for (const p of pending) {
        const file = p.file.type === "image/gif" ? p.file : await shrinkImage(p.file, 1920);
        const ext = file.type === "image/png" ? "png" : file.type === "image/gif" ? "gif" : file.type === "image/webp" ? "webp" : "jpg";
        const path = `${conv}/${crypto.randomUUID()}.${ext}`;
        let width: number | undefined, height: number | undefined;
        try { const bmp = await createImageBitmap(file); width = bmp.width; height = bmp.height; bmp.close(); } catch { /* size unknown */ }
        const { error: e } = await sb.storage.from("dm").upload(path, file, { contentType: file.type || "image/jpeg" });
        if (e) throw new Error(`사진을 올리지 못했어요: ${e.message}`);
        attachments.push({ path, name: p.file.name, type: file.type, size: file.size, width, height });
      }
      const { data, error: e } = await sb.from("dm_messages")
        .insert({ conversation_id: conv, sender_id: me.id, body, attachments }).select("*").single();
      if (e) throw e;
      stick.current = true;
      setMessages((prev) => (prev && !prev.some((x) => x.id === data.id) ? [...prev, data as DmMessage] : prev));
      setText("");
      pending.forEach((p) => URL.revokeObjectURL(p.url));
      setPending([]);
      void reload();
      textRef.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function unsend(m: DmMessage) {
    if (!confirm("이 메시지 보내기를 취소할까요? 상대방 화면에서도 사라져요.")) return;
    await sb.from("dm_messages").update({ deleted_at: new Date().toISOString() }).eq("id", m.id);
    if (m.attachments.length) await sb.storage.from("dm").remove(m.attachments.map((a) => a.path));
  }

  const paths = useMemo(() => (messages ?? []).flatMap((m) => m.attachments.map((a) => a.path)), [messages]);
  const urls = useSignedUrls(paths);
  const lastMine = [...(messages ?? [])].reverse().find((m) => m.sender_id === me.id && !m.deleted_at);
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const name = other?.display_name || other?.email || "알 수 없음";

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); addFiles([...e.dataTransfer.files]); }}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-11 pr-3 md:px-4">
        <button onClick={onBack} className="-ml-1 rounded p-1 hover:bg-hover md:hidden"><ArrowLeft size={18} /></button>
        <Avatar profile={other} size={24} />
        <span className="truncate font-medium">{name}</span>
      </header>

      <div
        ref={scroller}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-6"
      >
        {messages === null && !error && <Spinner />}
        {hasMore && (
          <div className="mb-3 text-center">
            <button onClick={() => void loadOlder()} className="rounded-md border border-line px-3 py-1 text-xs text-muted hover:bg-hover">이전 메시지 보기</button>
          </div>
        )}
        {messages?.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted">
            <Avatar profile={other} size={48} />
            <span><b className="text-foreground">{name}</b>님과의 첫 메시지를 보내 보세요.</span>
          </div>
        )}
        {messages?.map((m, i) => {
          const prev = messages[i - 1];
          const mine = m.sender_id === me.id;
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const grouped = !newDay && prev && prev.sender_id === m.sender_id && +new Date(m.created_at) - +new Date(prev.created_at) < 5 * 60_000;
          return (
            <div key={m.id}>
              {newDay && <div className="my-3 text-center text-[11px] text-muted">{dayLabel(m.created_at)}</div>}
              <div className={`group flex items-end gap-2 ${mine ? "flex-row-reverse" : ""} ${grouped ? "mt-0.5" : "mt-3"}`}>
                {!mine && <div className="w-7 shrink-0">{!grouped && <Avatar profile={other} size={28} />}</div>}
                <div className={`flex max-w-[78%] flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
                  {m.deleted_at ? (
                    <div className="rounded-2xl border border-dashed border-line px-3 py-1.5 text-sm text-muted">보내기를 취소한 메시지예요</div>
                  ) : (
                    <>
                      {m.attachments.length > 0 && (
                        <div className={`grid gap-1 ${m.attachments.length > 1 ? "grid-cols-2" : ""}`}>
                          {m.attachments.map((a) => {
                            const u = urls.get(a.path);
                            const ratio = a.width && a.height ? a.width / a.height : 4 / 3;
                            return (
                              <button key={a.path} onClick={() => u && setLightbox(u)} className="block overflow-hidden rounded-xl bg-hover"
                                style={{ width: m.attachments.length > 1 ? 140 : Math.min(260, 260 * Math.min(1, ratio)), aspectRatio: m.attachments.length > 1 ? "1" : String(ratio) }}>
                                {u && <img src={u} alt={a.name} className="h-full w-full object-cover" loading="lazy" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {m.body && (
                        <div className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[15px] leading-snug ${mine ? "bg-accent text-white" : "bg-hover"}`}>
                          {m.body}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className={`flex shrink-0 flex-col pb-0.5 text-[10px] text-muted ${mine ? "items-end" : "items-start"}`}>
                  {mine && !m.deleted_at && (
                    <button title="보내기 취소" onClick={() => void unsend(m)} className="touch-show mb-0.5 rounded p-0.5 opacity-0 hover:bg-hover group-hover:opacity-100">
                      <Trash2 size={12} />
                    </button>
                  )}
                  {m.id === lastMine?.id && otherRead && otherRead >= m.created_at && <span>읽음</span>}
                  <span>{timeLabel(m.created_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-line p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-4">
        {error && <p className="mb-1 px-1 text-xs text-red-500">{error}</p>}
        {pending.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {pending.map((p) => (
              <div key={p.id} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line">
                <img src={p.url} alt="" className="h-full w-full object-cover" />
                <button onClick={() => { URL.revokeObjectURL(p.url); setPending((l) => l.filter((x) => x.id !== p.id)); }}
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"><X size={11} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
          <button title="사진 첨부" disabled={!conv} onClick={() => fileInput.current?.click()} className="rounded-full p-2 text-muted hover:bg-hover disabled:opacity-40">
            <ImagePlus size={20} />
          </button>
          <textarea
            ref={textRef}
            rows={1}
            value={text}
            disabled={!conv}
            onChange={(e) => {
              setText(e.target.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = Math.min(160, e.currentTarget.scrollHeight) + "px";
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) { e.preventDefault(); addFiles(files); }
            }}
            onKeyDown={(e) => {
              // Desktop: Enter sends, Shift+Enter is a new line. Phones keep Enter as a new line.
              if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }}
            placeholder={`${name}님에게 메시지`}
            maxLength={4000}
            className="max-h-40 min-h-[40px] flex-1 resize-none rounded-2xl border border-line bg-transparent px-3 py-2 text-[15px] outline-none focus:border-accent"
          />
          <button
            title="보내기"
            disabled={!conv || sending || (!text.trim() && !pending.length)}
            onClick={() => void send()}
            className="rounded-full bg-accent p-2.5 text-white disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      {over && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-accent bg-accent/5 text-sm font-medium text-accent">
          사진을 놓으면 첨부돼요
        </div>
      )}
      {lightbox && (
        <div className="fixed inset-0 z-[98] flex items-center justify-center bg-black/85 p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
          <button className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] rounded-full bg-white/15 p-2 text-white"><X size={18} /></button>
        </div>
      )}
    </div>
  );
}
