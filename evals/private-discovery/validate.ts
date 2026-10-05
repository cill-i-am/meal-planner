import { fileURLToPath } from "node:url";

import {
  privateDiscoveryAssets,
  validatePrivateDiscoveryAssets,
} from "./validate-assets.js";

validatePrivateDiscoveryAssets(
  privateDiscoveryAssets,
  fileURLToPath(new URL("../../", import.meta.url))
);
