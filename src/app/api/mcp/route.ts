import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { anonClient, createNewtionMcp } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function unauthorized(message: string) {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message }, id: null },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="newtion"' } },
  );
}

/** Claude connects here with `Authorization: Bearer <Newtion API token>`. Stateless Streamable HTTP. */
async function handle(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return unauthorized("Newtion API 토큰이 필요합니다. 설정 → Claude 연결에서 발급하세요.");
  const { error } = await anonClient().rpc("mcp_whoami", { p_token: token });
  if (error) return unauthorized("토큰이 올바르지 않거나 폐기되었습니다.");

  const server = createNewtionMcp(token);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Stateless: one server per request.
    void server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
