import * as Cloudflare from "alchemy/Cloudflare";

import type { HouseholdDomainWorkerMethods } from "./household-domain-worker.js";

/** Stable service-binding token without importing the Worker implementation. */
export class HouseholdDomainWorker extends Cloudflare.Worker<
  HouseholdDomainWorker,
  Cloudflare.WorkerShape & HouseholdDomainWorkerMethods
>()("HouseholdDomainWorker") {}
