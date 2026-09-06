declare module "cloudflare:workers" {
  import { CloudflareWorkersModule } from "@cloudflare/workers-types";
  export import DurableObject = CloudflareWorkersModule.DurableObject;
  export import WorkerEntrypoint = CloudflareWorkersModule.WorkerEntrypoint;
}

declare namespace Cloudflare {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- Agents uses this ambient, mergeable environment interface; runtime capabilities remain explicitly typed per class.
  interface Env {}
}
