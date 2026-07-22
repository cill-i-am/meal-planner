import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

import TypeScript from "typescript";

const repositoryUrl = new URL("../", import.meta.url).href;
const packageModulesUrl = new URL("../node_modules/", import.meta.url).href;

const isRepositorySource = (url) =>
  url.startsWith(repositoryUrl) && !url.startsWith(packageModulesUrl);

const isRepositoryTypeScript = (url) =>
  isRepositorySource(url) && url.endsWith(".ts");

registerHooks({
  load(url, context, nextLoad) {
    if (!isRepositoryTypeScript(url)) {
      return nextLoad(url, context);
    }

    const fileName = decodeURIComponent(url.slice(repositoryUrl.length));
    const transformed = TypeScript.transpileModule(
      readFileSync(fileURLToPath(url), "utf-8"),
      {
        compilerOptions: {
          inlineSourceMap: true,
          inlineSources: true,
          isolatedModules: true,
          module: TypeScript.ModuleKind.ESNext,
          target: TypeScript.ScriptTarget.ES2024,
          verbatimModuleSyntax: true,
        },
        fileName,
        reportDiagnostics: true,
      }
    );
    const errors = (transformed.diagnostics ?? []).filter(
      (diagnostic) =>
        diagnostic.category === TypeScript.DiagnosticCategory.Error
    );

    if (errors.length > 0) {
      const message = errors
        .map((diagnostic) =>
          TypeScript.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
        )
        .join("\n");
      throw new SyntaxError(
        `TypeScript transform failed for ${fileName}:\n${message}`
      );
    }

    return {
      format: "module",
      shortCircuit: true,
      source: transformed.outputText,
    };
  },
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        context.parentURL === undefined ||
        !isRepositorySource(context.parentURL) ||
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
