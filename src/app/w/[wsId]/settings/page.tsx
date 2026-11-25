"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace-context";
import { Avatar } from "@/components/ui";
import { ClaudeConnect } from "@/components/claude-connect";
import type { Role } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = { owner: "소유자", editor: "편집자", viewer: "뷰어" };

interface Invite { id: string; email: string; role: Role; created_at: string }

export default function SettingsPage() {
  const { sb, me, workspace, members, role, reloadMembers, reloadWorkspace } = useWorkspace();
  const router = useRouter();
  const isOwner = role === "owner";
  const [name, setName] = useState(workspace.name);
  const [icon, setIcon] = useState(workspace.icon);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [displayName, setDisplayName] = useState(me.display_name);
  const [msg, setMsg] = useState<string | null>(null);

  const loadInvites = async () => {
    const { data } = await sb.from("workspace_invites").select("*").eq("workspace_id", workspace.id).order("created_at");
    setInvites((data ?? []) as Invite[]);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadInvites(); }, [workspace.id]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2500); };

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await sb.rpc("invite_member", { p_workspace: workspace.id, p_email: email, p_role: inviteRole });
    if (error) return flash(error.message);
    setEmail("");
    flash(data === "added" ? "멤버로 추가했습니다." : "초대를 저장했습니다. 해당 이메일로 가입하면 자동으로 참여합니다.");
    await Promise.all([reloadMembers(), loadInvites()]);
  }

  const card = "rounded-xl border border-line p-5";
  const input = "rounded-md border border-line bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 pb-24 pt-14 md:px-10">
        <h1 className="text-3xl font-bold">설정 및 멤버</h1>
        {msg && <div className="rounded-md bg-accent/10 px-3 py-2 text-sm text-accent">{msg}</div>}

        <section className={card}>
          <h2 className="mb-3 font-semibold">내 프로필</h2>
          <div className="flex gap-2">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={`${input} flex-1`} />
            <button className="rounded-md bg-accent px-3 py-1.5 text-sm text-white" onClick={async () => {
              await sb.from("profiles").update({ display_name: displayName }).eq("id", me.id);
              await reloadMembers();
              flash("프로필을 저장했습니다. (새로고침 후 전체 반영)");
            }}>저장</button>
          </div>
          <p className="mt-1 text-xs text-muted">{me.email}</p>
        </section>

        <section className={card}>
          <h2 className="mb-3 font-semibold">워크스페이스</h2>
          <div className="flex gap-2">
            <input value={icon} onChange={(e) => setIcon(e.target.value)} disabled={!isOwner} className={`${input} w-14 text-center`} />
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} className={`${input} flex-1`} />
            {isOwner && (
              <button className="rounded-md bg-accent px-3 py-1.5 text-sm text-white" onClick={async () => {
                await sb.from("workspaces").update({ name, icon }).eq("id", workspace.id);
                await reloadWorkspace();
                flash("저장했습니다.");
              }}>저장</button>
            )}
          </div>
        </section>

        <section className={card}>
          <h2 className="mb-3 font-semibold">멤버 ({members.length})</h2>
          {isOwner && (
            <form onSubmit={invite} className="mb-4 flex flex-wrap gap-2">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="초대할 이메일" className={`${input} min-w-0 flex-1 basis-full sm:basis-auto`} />
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className={`${input} bg-background`}>
                <option value="editor">편집자</option>
                <option value="viewer">뷰어</option>
                <option value="owner">소유자</option>
              </select>
              <button className="rounded-md bg-accent px-3 py-1.5 text-sm text-white">초대</button>
            </form>
          )}
          <div className="divide-y divide-line">
            {members.map((m) => (
              <div key={m.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Avatar profile={m.profile} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.profile.display_name} {m.user_id === me.id && <span className="text-muted">(나)</span>}</div>
                  <div className="truncate text-xs text-muted">{m.profile.email}</div>
                </div>
                {isOwner && m.user_id !== me.id ? (
                  <>
                    <select value={m.role} className={`${input} bg-background`} onChange={async (e) => {
                      await sb.from("workspace_members").update({ role: e.target.value }).eq("workspace_id", workspace.id).eq("user_id", m.user_id);
                      await reloadMembers();
                    }}>
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                    <button className="text-sm text-red-500 hover:underline" onClick={async () => {
                      if (!confirm(`${m.profile.display_name}님을 내보낼까요?`)) return;
                      await sb.from("workspace_members").delete().eq("workspace_id", workspace.id).eq("user_id", m.user_id);
                      await reloadMembers();
                    }}>내보내기</button>
                  </>
                ) : (
                  <span className="text-sm text-muted">{ROLE_LABEL[m.role]}</span>
                )}
              </div>
            ))}
          </div>
          {invites.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-xs font-semibold text-muted">대기 중인 초대</div>
              {invites.map((i) => (
                <div key={i.id} className="flex items-center gap-2 py-1 text-sm">
                  <span className="flex-1 truncate">{i.email}</span>
                  <span className="text-muted">{ROLE_LABEL[i.role]}</span>
                  {isOwner && (
                    <button className="text-red-500 hover:underline" onClick={async () => {
                      await sb.from("workspace_invites").delete().eq("id", i.id);
                      await loadInvites();
                    }}>취소</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <ClaudeConnect />

        <section className={`${card} border-red-500/40`}>
          <h2 className="mb-3 font-semibold text-red-500">위험 구역</h2>
          <div className="flex flex-wrap gap-2">
            {!isOwner && (
              <button className="rounded-md border border-red-500/50 px-3 py-1.5 text-sm text-red-500" onClick={async () => {
                if (!confirm("워크스페이스에서 나갈까요?")) return;
                await sb.from("workspace_members").delete().eq("workspace_id", workspace.id).eq("user_id", me.id);
                router.replace("/w");
              }}>워크스페이스 나가기</button>
            )}
            {isOwner && (
              <button className="rounded-md bg-red-500 px-3 py-1.5 text-sm text-white" onClick={async () => {
                if (prompt(`삭제하려면 워크스페이스 이름 "${workspace.name}"을 입력하세요.`) !== workspace.name) return;
                await sb.from("workspaces").delete().eq("id", workspace.id);
                try { localStorage.removeItem("newtion:lastWs"); } catch {}
                router.replace("/w?new=1");
              }}>워크스페이스 삭제</button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
