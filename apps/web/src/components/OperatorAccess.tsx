import { useEffect, useState, type FormEvent } from "react";

type Session = { mode: "authenticated" | "local_demo"; authenticated: boolean; actor: string | null; agentConfigured: boolean };

export function OperatorAccess({ onChange }: { onChange: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => fetch("/api/session").then(response => {
    if (!response.ok) throw new Error("연결 실패");
    return response.json() as Promise<Session>;
  }).then(setSession).catch(() => setError("서버 연결을 확인해주세요."));
  useEffect(() => { void load(); }, []);
  const login = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "로그인에 실패했습니다.");
      setPassword(""); await load(); onChange();
    } catch (error) { setError(error instanceof Error ? error.message : "로그인에 실패했습니다."); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/session", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("로그아웃에 실패했습니다.");
      await load(); onChange();
    } catch { setError("로그아웃에 실패했습니다."); }
    finally { setBusy(false); }
  };
  return <aside className="access-strip" aria-label="운영자 접근 상태">
    <span className="access-label">WORKSPACE / 01</span>
    <div><strong>{session?.mode === "local_demo" ? "로컬 데모" : session?.authenticated ? `운영자 · ${session.actor}` : "운영자 로그인"}</strong>
      <span>{session?.mode === "local_demo" ? "실제 자산 이동 없이 지출 정책을 검증합니다." : "승인 권한은 운영자에게만 있습니다."}</span></div>
    {session?.mode === "authenticated" && !session.authenticated && <form onSubmit={login}>
      <input aria-label="운영자 암호" autoComplete="current-password" type="password" value={password} onChange={event => setPassword(event.target.value)} required />
      <button disabled={busy} type="submit">{busy ? "확인 중" : "로그인"}</button>
    </form>}
    {session?.mode === "authenticated" && session.authenticated && <button disabled={busy} onClick={logout} type="button">로그아웃</button>}
    <span className={`access-state ${session?.agentConfigured ? "is-connected" : ""}`}>{session?.agentConfigured ? "에이전트 연결 준비됨" : "에이전트 연결 미설정"}</span>
    {error && <p role="alert">{error}</p>}
  </aside>;
}
