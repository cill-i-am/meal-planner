/** Shared inputs for the deployed Website and its local Alchemy build. */
export const websiteSource = {
  main: "src/worker.ts",
  memo: {
    include: [
      "src/**",
      "package.json",
      "tsconfig.json",
      "vite.config.ts",
      "../../packages/*/package.json",
      "../../packages/*/src/**",
    ],
    lockfile: true,
  },
};
