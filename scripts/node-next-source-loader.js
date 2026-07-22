import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

const repositoryUrl = new URL("../", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        context.parentURL?.startsWith(repositoryUrl) !== true ||
        !specifier.startsWith(".") ||
        !specifier.endsWith(".js")
      ) {
        throw error;
      }

      const sourceUrl = new URL(
        `${specifier.slice(0, -3)}.ts`,
        context.parentURL
      );
      if (!sourceUrl.href.startsWith(repositoryUrl) || !existsSync(sourceUrl)) {
        throw error;
      }

      return nextResolve(sourceUrl.href, context);
    }
  },
});
