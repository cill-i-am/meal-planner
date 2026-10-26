import { bearer, defineProvider, object, secrets, string } from "apps";
import { mcpHealth } from "apps/mcp";

export const sigenMcpUrl = "https://sigen-api.barroncillian.workers.dev/mcp";

export const sigen = defineProvider({
  auth: {
    serviceKey: secrets({
      fields: object({ token: string({ minLength: 64 }) }),
      label: "Private Sigen MCP service credential",
      request: ({ token }) => bearer(token),
    }),
  },
  health: (check) =>
    mcpHealth(check, { headers: check.account.headers(), url: sigenMcpUrl }),
  hosts: ["sigen-api.barroncillian.workers.dev"],
  name: "Private Sigen MCP",
});
