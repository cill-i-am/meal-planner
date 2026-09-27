import start from "../.output/server/_ssr/ssr.mjs";
import { createWebsiteHandler } from "../src/website-handler.js";

const website = createWebsiteHandler(start);
export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith("/__test/")) {
      return env.MEAL_PLANNER_API.fetch(request);
    }
    // Only this isolated fixture accepts a test IP; production trusts Cloudflare.
    const headers = new Headers(request.headers);
    const clientIP = headers.get("x-test-client-ip");
    if (clientIP) {
      headers.set("cf-connecting-ip", clientIP);
    }
    headers.delete("x-test-client-ip");
    return website.fetch(new Request(request, { headers }), env);
  },
};
