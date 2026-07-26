declare module "cloudflare:workers" {
  export abstract class WorkflowEntrypoint<Env = unknown> {
    protected readonly env: Env;

    constructor(context: unknown, env: Env);

    abstract run(event: unknown, step: unknown): Promise<unknown>;
  }
}
