"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginForm() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/w";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const redirectTo = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { data: { display_name: name || email.split("@")[0] }, emailRedirectTo: redirectTo() },
        });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          setMsg({ kind: "info", text: "확인 메일을 보냈어요. 메일의 링크를 눌러 가입을 완료하세요." });
        }
      }
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function magicLink() {
    if (!email) return setMsg({ kind: "error", text: "이메일을 입력하세요." });
    setBusy(true);
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
    setBusy(false);
    setMsg(error ? { kind: "error", text: error.message } : { kind: "info", text: "로그인 링크를 메일로 보냈어요." });
  }

  const input = "w-full rounded-md border border-line bg-transparent px-3 py-2 outline-none focus:border-accent";

  return (
    <main className="flex min-h-full items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        <div className="mb-6 text-center">
          <div className="text-4xl">🧩</div>
          <h1 className="mt-2 text-2xl font-bold">{mode === "signin" ? "Newtion에 로그인" : "Newtion 가입하기"}</h1>
        </div>
        {mode === "signup" && (
          <input className={input} placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <input className={input} type="email" required placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" required minLength={6} placeholder="비밀번호 (6자 이상)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} className="w-full rounded-md bg-accent py-2 font-semibold text-white disabled:opacity-60">
          {busy ? "처리 중…" : mode === "signin" ? "로그인" : "가입하기"}
        </button>
        {mode === "signin" && (
          <button type="button" onClick={magicLink} disabled={busy} className="w-full rounded-md border border-line py-2 text-sm hover:bg-hover">
            ✉️ 비밀번호 없이 메일 링크로 로그인
          </button>
        )}
        {msg && (
          <p className={`text-sm ${msg.kind === "error" ? "text-red-500" : "text-green-600"}`}>{msg.text}</p>
        )}
        <p className="pt-2 text-center text-sm text-muted">
          {mode === "signin" ? "계정이 없나요? " : "이미 계정이 있나요? "}
          <button type="button" className="text-accent underline" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(null); }}>
            {mode === "signin" ? "가입하기" : "로그인"}
          </button>
        </p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
