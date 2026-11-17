export const websiteDevPort = 4399;

const productionHostname = "ceird.app";

export const deployedWebsiteHostname = (dev: boolean, stage: string) => {
  if (dev) {
    return;
  }
  if (stage === "prod") {
    return productionHostname;
  }
  if (stage === "e2e") {
    return `e2e.${productionHostname}`;
  }
};
