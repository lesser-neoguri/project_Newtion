import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

function rpcError(status: number, message: string, headers?: Record<string, string>) {
  return Response.json({ jsonrpc: "2.0", error: { code: status === 401 ? -32001 : -32603, message }, id: null }, { status, headers });
}

/** Claude connects here with `Authorization: Bearer <Newtion API token>`. Stateless Streamable HTTP. */
async function handle(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const unauthorized = (m: string) => rpcError(401, m, { "WWW-Authenticate": 'Bearer realm="newtion"' });
  if (!token) return unauthorized("Newtion API 토큰이 필요합니다. 설정 → Claude 연결에서 발급하세요.");

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.rpc("mcp_whoami", { p_token: token });
  if (error) return unauthorized("토큰이 올바르지 않거나 폐기되었습니다.");

  try {
    // Loaded lazily: the document tools pull in BlockNote + jsdom.
    const { createNewtionMcp } = await import("@/lib/mcp/server");
    const server = createNewtionMcp(token);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      void server.close();
    }
  } catch (e) {
    console.error("mcp route error", e);
    return rpcError(500, `Newtion MCP 서버 오류: ${(e as Error).message ?? e}`);
  }
}

export { handle as GET, handle as POST, handle as DELETE };
