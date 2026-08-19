declare module "cloudflare:workers" {
  /** Native RPC entrypoint used only by the bundled real-runtime fixture. */
  export abstract class WorkerEntrypoint<Env = Record<string, never>> {
    protected readonly ctx: ExecutionContext;
    protected readonly env: Env;

    constructor(ctx: ExecutionContext, env: Env);
  }
}
