# Sigen in Executor

This app connects the independent Sigen MCP service to Executor using a personal service account. It follows the Tesco integration's per-user account pattern. Credentials are opaque handles restricted to `sigen-api.barroncillian.workers.dev`. The service's owner credential is separate from both the Sigen password and the operator credential used for enrollment.

The provider's health check initializes MCP and lists tools with the credential, then confirms that the same requests fail without it. It does not run a tool. Read-only tools need no Executor approval. Other tools require approval; the current service exposes only reads. The future approve-once/always-approve command workflow remains unfinished in the service and this bridge.

The app was type-checked against the host's pinned `apps@0.0.1-beta.110` and deployed on 26 October 2026 as `app_61688251-69bd-4268-9bc3-b8880ab2a777`, deployment `dpl_1febfea9-3508-4990-af57-c4a219956e2a`. The user completed the secure personal-account connection, and all 19 read tools passed through Executor on 26 October 2026. This is actual client acceptance beyond deployment and health checks; see [read acceptance](../../../docs/sigen/read-acceptance.md).

For changes, read Executor's current app-authoring skill and working source, commit the complete file list with the expected source revision, then deploy that returned commit. Never put credentials in source or tool arguments. Connect through Executor's user-account form, using the service owner token from the protected local `.dev.vars.sigen-owner.json` file. Do not use the Sigen password or the operator token. See the [service runbook](../../../apps/sigen-api/README.md).
