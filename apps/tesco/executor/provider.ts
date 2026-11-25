import { bearer, defineProvider, object, secrets, string } from "apps";
import { mcpHealth } from "apps/mcp";

export const tescoMcpUrl = "https://tesco-mcp.barroncillian.workers.dev/mcp";

/** Opaque account handles can be substituted only into this host's Bearer header. */
export const tesco = defineProvider({
  auth: {
    serviceKey: secrets({
      fields: object({ token: string({ minLength: 64 }) }),
      label: "Private Tesco MCP service credential",
      request: ({ token }) => bearer(token),
    }),
  },
  health: (check) =>
    mcpHealth(check, { headers: check.account.headers(), url: tescoMcpUrl }),
  hosts: ["tesco-mcp.barroncillian.workers.dev"],
  name: "Private Tesco MCP",
});
