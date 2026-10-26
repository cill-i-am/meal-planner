import { accountRouter, defineApp, toolAnnotations, withApprovals } from "apps";
import { mcpRouter } from "apps/mcp";
import { always } from "apps/operations/approval";

import { sigen, sigenMcpUrl } from "./provider.js";

export default defineApp(
  { user: { accounts: { service: sigen.many() } } },
  async (ctx) => ({
    tools: await accountRouter(
      ctx.user?.accounts.service ?? [],
      async (account) =>
        withApprovals(
          await mcpRouter({
            account,
            cache: ctx.cache,
            headers: account.headers(),
            signal: ctx.signal,
            url: sigenMcpUrl,
          }),
          (tool) =>
            toolAnnotations(tool)?.readOnlyHint === true ? undefined : always()
        ),
      { signal: ctx.signal }
    ),
  })
);
