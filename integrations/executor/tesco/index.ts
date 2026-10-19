import { accountRouter, defineApp, toolAnnotations, withApprovals } from "apps";
import { mcpRouter } from "apps/mcp";

import { tescoApproval } from "./approval.js";
import { tesco, tescoMcpUrl } from "./provider.js";

/** Each member supplies their own account; the owner's credential is never an app-wide shared account. */
export default defineApp(
  { user: { accounts: { service: tesco.many() } } },
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
            url: tescoMcpUrl,
          }),
          (tool, name) =>
            tescoApproval(name, toolAnnotations(tool)?.readOnlyHint)
        ),
      { signal: ctx.signal }
    ),
  })
);
