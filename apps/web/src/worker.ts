import start from "@tanstack/react-start/server-entry";

import { createWebsiteHandler } from "./website-handler.js";

export default createWebsiteHandler(start);
