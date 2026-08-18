declare module "cloudflare:workers" {
  export abstract class WorkflowEntrypoint<Env = unknown> {
    protected readonly env: Env;

    constructor(
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- TODO(ASU006 alchemy@2.0.0-beta.72): WorkflowEntrypoint constructor(context, env) is an erased behavioral host contract; Schema cannot manufacture ExecutionContext identity or runtime methods. Remove when Alchemy provides public precise host types or supported real-runtime harness.
      context: unknown,
      env: Env
    );

    abstract run(
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- TODO(ASU007 alchemy@2.0.0-beta.72): WorkflowEntrypoint.run(event, step) exposes an erased behavioral host object; Schema cannot manufacture WorkflowEvent identity or runtime methods. Remove when Alchemy provides public precise host types or supported real-runtime harness.
      event: unknown,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- TODO(ASU008 alchemy@2.0.0-beta.72): WorkflowEntrypoint.run(event, step) exposes an erased behavioral host object; Schema cannot manufacture WorkflowStep identity or runtime methods. Remove when Alchemy provides public precise host types or supported real-runtime harness.
      step: unknown
    ): Promise<unknown>;
  }
}
