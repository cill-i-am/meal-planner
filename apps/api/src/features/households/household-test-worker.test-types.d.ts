declare module "cloudflare:workers" {
  /** Native host base class used only by the bundled real-runtime fixture. */
  export abstract class DurableObject<Env = Record<string, never>> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;

    constructor(ctx: DurableObjectState, env: Env);
  }
}
