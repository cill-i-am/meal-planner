/** Shared inputs for the deployed Website and its local Alchemy build. */
export const websiteSource = {
  main: "src/worker.ts",
  memo: {
    include: [
      "src/**",
      "public/**",
      "website-source.ts",
      "../../tsconfig.base.json",
      "package.json",
      "tsconfig.json",
      "vite.config.ts",
      "../../packages/*/package.json",
      "../../packages/*/src/**",
    ],
    lockfile: true,
  },
};
