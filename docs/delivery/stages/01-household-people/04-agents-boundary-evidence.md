# Private interview boundary — SDK evidence

## Recommendation

Do not add a Household interview grant, placeholder session table, or profile
command in Stage 1. Implement the private interview vertical in Stage 2, with
participant metadata and conversation lifecycle in the isolated Agent. Resolve
current membership and the account-to-person link through existing authorities;
an Agent reference or a saved participant snapshot is not authorization.

This recommendation is supported by an actual provider-free SDK runtime probe,
not by an implemented product interview. The probe establishes that Agent-owned
metadata and isolated sub-agents work on the repository's local runtime. It does
**not** certify production authentication, streaming revocation, or deployment.
Those remain explicit Stage 2 gates below. No need for a Household grant emerged;
adding one would introduce a second lifecycle and cross-store coordination
without solving those gates.

## Provenance and versions

Investigated on 2026-09-05 from freshly fetched `origin/main`
`b509ba53ce1ac1326e86a9e826bdf58cbb0e7856`, the merge of PR #202.
The repository has no Agents SDK dependency. The disposable probe selected the
public npm release `agents@0.22.0`; this document does not add a product pin.

| Component          | Exact version / setting       | Evidence scope                                                                    |
| ------------------ | ----------------------------- | --------------------------------------------------------------------------------- |
| Agents SDK         | `0.22.0`                      | Installed release, real `Agent`, `subAgent`, and sub-agent HTTP/WebSocket routing |
| Miniflare          | `4.20260714.0`                | Matches API package pin                                                           |
| workerd            | `1.20260714.1`                | Miniflare's installed runtime dependency                                          |
| Compatibility date | `2026-07-14`, `nodejs_compat` | Disposable probe configuration, not a product configuration change                |
| Alchemy            | `2.0.0-beta.72`               | Repository pin inspected; its deployment/bundle composition was not exercised     |
| Effect             | `4.0.0-rc.109`                | Repository pin and existing authority seams inspected                             |
| Better Auth        | `1.7.0-rc.6`                  | Existing implementation inspected; not replaced by the SDK                        |
| esbuild            | `0.25.12`                     | Disposable ESM bundle; not the Alchemy bundler                                    |
| Host               | Node `26.8.1`, macOS arm64    | Probe execution host                                                              |

The Agents tarball integrity was
`sha512-dIy/BRdO5GSqdOIp0pmkcLmHCCxIKb4RBByXFXmXG6Nc6WBSNYRXoLLDvWj2fJAfi4l5/OndJjZuBAP0vW0DZQ==`.
Install a fresh probe from these exact top-level versions and retain its npm
lockfile when repeating: transitive ranges can otherwise change. Native
workerd/esbuild platform packages must match their parent versions.

No application, dependency, schema, infrastructure, or cloud state changed.
The probe stored only synthetic identity/lifecycle metadata, not messages,
transcripts, proposals, credentials, or model output. No model/provider was
configured or called.

## Existing product authority

These are source-backed observations at the base commit, not new runtime claims:

- [`auth.principal.ts`](../../../../apps/api/src/features/auth/auth.principal.ts)
  obtains the session and current Better Auth member, then verifies both the
  organization and immutable user ID. A session's active organization alone is
  insufficient.
- [`household-people.identity.ts`](../../../../apps/api/src/features/households/people/household-people.identity.ts)
  derives the household-scoped linkage subject from organization ID and immutable
  Better Auth user ID. Its domain/purpose differ from the audit actor digest.
  Session ID, email, and membership-row ID are not linkage identity.
- [`household.http.ts`](../../../../apps/api/src/features/households/household.http.ts)
  supplies fresh admitted identity to the private household boundary.
- [`household-profile.repository.ts`](../../../../apps/api/src/features/households/profiles/household-profile.repository.ts)
  joins the linkage subject to a linked, active adult person. Profile mutation
  authorization, replay, expected-version validation, safety checks, and version
  append remain household-local. An Agent cannot replace this with cached role
  or participant metadata.
- [`profiles.ts`](../../../../packages/household-api/src/profiles.ts)
  defines closed `AddConfirmedProfileFact`, `ConfirmProfileFact`, and
  `ConfirmHardConstraintReduction` operations alongside provisional/edit/remove
  operations. The implemented provenance is **only `manual_ui`**. A future
  `private_interview_proposal` source is not implemented and must not be spoofed
  as manual entry. Add a narrowly typed, privacy-safe provenance variant in the
  later confirmation slice, with its tests, rather than letting the Agent write
  the profile ledger directly.

The future participant binding is household + immutable account linkage subject

- stable person ID. Retain it in the isolated Agent, compare it with current
  admission on access, and never silently retarget an existing interview after
  link repair. The same account in another household is a different binding.

## Runtime results and limits

The first smoke executed a real parent Agent, persisted a metadata revision,
and called `subAgent(PrivateChild, name).inspect()`. All three responses were
HTTP 200. Public SDK facets work on this exact local runtime; an equivalent
child-DO fallback was not needed.

The second run used a synthetic KV authority service to isolate the SDK seam.
Its fixed `u1/h1/p1` values are **fixture identities, not a proposed credential
scheme**. The production route must derive identities from Better Auth and
Household authority; it must not trust these test headers or literals.

| Check                                                                  | Observed result                                                                           | What remains unproven                                                                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Participant versus another adult, another household, or unknown caller | Participant metadata readable; other callers receive uniform 404                          | Real Better Auth sessions and real account-link transitions composed with Agent routing                             |
| Copied opaque reference                                                | The known test reference does not bypass admission                                        | Random identity allocation, concurrent session creation, collision and lost-create response handling                |
| Client SDK state-sync write                                            | Public readonly hook rejects `cf_agent_state`; persisted metadata unchanged               | Every future callable, chat protocol, tool and streaming path                                                       |
| Membership removed during an established connection                    | Next custom message checks synthetic authority, closes with code 1008; reconnect gets 404 | Passive sockets, in-flight responses, queued output, streaming, and push revocation without another inbound message |
| Person link changes                                                    | Former person binding denied                                                              | Real unlink/repair/departure races and fail-closed authority outages                                                |
| Completion and restart                                                 | Completed metadata retained after full Miniflare dispose/recreate; reopen gets 409        | Transcript retention/deletion policy implementation and real session mutation receipts                              |

The successful boundary run printed:

```text
PASS participant / other-adult / other-household / opaque-reference denial
PASS SDK state-sync mutation blocked with public readonly hook
PASS live message recheck closes departed participant; reconnect denied
PASS unlink denial; completed metadata retained read-only across runtime restart
```

An initial probe incorrectly forwarded a WebSocket through the parent's ordinary
request handler. The parent handled its own SDK protocol instead of the child's.
The correction uses public `routeSubAgentRequest` plus `onBeforeSubAgent`, not an
internal SDK patch. This is why HTTP success is not WebSocket boundary proof.

The shipped SDK handles state-sync and callable RPC before a subclass's custom
`onMessage`. Checking only that handler is insufficient. The probe disables
protocol state broadcasting with `shouldSendProtocolMessages`, makes client
state readonly, and exposes no callable RPC. These are narrow probe settings,
not a validated production chat framework. Stage 2 must audit every enabled
protocol and reauthorize before private output; readonly alone does not protect
confidentiality, and connection-time authorization is not continuing access.
The public `getSubAgentByName` RPC path bypasses the parent's
`onBeforeSubAgent` routing hook. Any future RPC caller must enforce its own
current admission; the parent is not implicitly entitled to private child data.

## Lifecycle and proposal contract

- An admitted active linked adult may begin an interview only about themselves.
  Other adults cannot list its existence, read it, participate, complete it, or
  resolve a copied reference. Dependants have no account/interview surface here.
- A session's participant, person, and household binding is immutable. A new
  session has its own opaque ID and Agent-owned version/receipt semantics.
- `open -> completed` retains private history read-only. Completed is not revoked
  or deleted, and cannot reopen. A currently authorized participant may read
  retained completed history under PDR 0001.
- Revocation denies further access; it does not silently erase history.
  Departure/unlink/archive prevents access even if the saved session is open or
  completed. Restoration does not authorize a different person or override a
  session's explicit revocation. Deletion/support access are separate policies.
- A proposed fact remains private and noncanonical. The participant reviews a
  closed fact, then makes a separately authenticated normal profile command.
  Current membership/link/lifecycle, expected profile version, mutation identity,
  and explicit hard-constraint reduction confirmation all still apply. A revoked
  session cannot serve as authorization or inject transcript data into audit.
- No network, Agent, or provider call enters a household SQLite transaction.

## Smallest Stage 2 handoff

Keep Stage 2 implementation **Proposed** until this boundary record is reviewed.
Then assign one provider-free integration slice, not the whole AI roadmap:

1. Start from freshly fetched main and the accepted Stage 1 records. Recheck the
   Agents release and actual Alchemy bundle/export seam; use a supported public
   SDK path with no shim. Product pin/infrastructure changes belong to that PR.
2. Implement participant-only creation/resolution and lifecycle metadata in
   isolated Agents, with server-derived household/account/person identity. No
   Household grant/table unless a new concrete blocker proves it necessary and
   the decision is reviewed.
3. Compose real Better Auth session + current member checks and real household
   linked-adult admission. Check before routing and again at the point of
   private read/write/output. Establish an explicit live-connection revocation
   protocol, including authority-read failure and in-flight output. Do not
   describe a polling window as immediate revocation.
4. Prove another adult/cross-household denial, reconnect and established-session
   departure/unlink denial, stable identity, creation ambiguity/collision,
   lifecycle concurrency, retained completed metadata, and restart through real
   Workerd/Miniflare production composition. Audit state sync, callable RPC,
   internal RPC exposure, and parent-to-child access—not only custom messages.
5. Keep messages, transcripts, models, providers, streaming, chat UI, interviews,
   support grants, deletion, and the eval harness out of that first integration
   slice. A minimal session shell is sufficient only if the slice needs visible
   creation/lifecycle proof. No placeholder profile provenance or privileged
   Agent profile writer.
6. After that gate, separately specify durable private conversation and explicit
   profile-proposal confirmation. Before exposing content, prove outbound
   revocation across the actual conversation transport. A profile handoff must
   exercise existing replay/version/safety rules and closed content rejection.

Each implementation PR needs relevant root checks, real boundary proof, hosted
CI, and independent exact-head review. This docs-only spike did not rerun the
unchanged product test suite or container build locally; its PR's hosted checks
remain a separate delivery gate. It neither completes Stage 2 nor proves the
cumulative Stage 1 product tracer anew.

## Official sources

Read on 2026-09-05; API observations were checked against installed `agents@0.22.0`:

- [Agents routing](https://developers.cloudflare.com/agents/runtime/communication/routing/)
  — server-selected names and admission hooks.
- [Sub-agents](https://developers.cloudflare.com/agents/runtime/execution/sub-agents/)
  — isolated facet storage, public routing, abort versus deletion.
- [Agent lifecycle API](https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/)
  — state and communication lifecycle.
- [Readonly connections](https://developers.cloudflare.com/agents/runtime/communication/readonly-connections/)
  — client write restrictions do not imply private-read authorization.
- [WebSockets](https://developers.cloudflare.com/agents/runtime/communication/websockets/)
  — continuing connections require their own lifecycle policy.
- [Published Agents package](https://www.npmjs.com/package/agents/v/0.22.0)
  — exact release. Shipped `dist/src-5W6JNKVb.js` contains protocol dispatch,
  `shouldSendProtocolMessages`, and facet resolution; `dist/sub-routing.js`
  contains the public HTTP/WebSocket route helper.

## Reproduce the disposable probe

Create a disposable directory outside the repository. Install `agents@0.22.0`,
`miniflare@4.20260714.0`, and `esbuild@0.25.12` with npm and retain the resulting
lockfile. On the observed macOS arm64 host, the native packages were
`@cloudflare/workerd-darwin-arm64@1.20260714.1` and
`@esbuild/darwin-arm64@0.25.12`. Use the equivalent same-version packages on
another platform. Local Miniflare needs loopback-listener permission. No provider
credentials or Alchemy deploy/plan/dev command is needed.

Save the following two listings as `boundary.js` and `boundary-test.mjs` in that
directory, then run `node boundary-test.mjs`. Use fresh storage directories for a
fresh run; the test itself disposes/restarts the same persisted instance. These
are synthetic test-only JavaScript fixtures, not application code to copy into
the product. In particular, replace neither real auth nor domain schemas with
their deliberately fixed test authority.

```javascript
import { Agent, getAgentByName, routeSubAgentRequest } from "agents";

// Synthetic authority service, not Better Auth or HouseholdObject.
async function admitted(env, account, household, person) {
  const current = await env.AUTH.get(account, "json");
  return current?.active === true && current.household === household && current.person === person;
}
export class HouseholdAgent extends Agent {
  static options = { sendIdentityOnConnect: false };
  async onBeforeSubAgent(request) {
    if (
      request.headers.get("x-probe-account") !== "u1" ||
      !(await admitted(this.env, "u1", "h1", "p1"))
    )
      return new Response("Not found", { status: 404 });
  }
}
export class PrivateInterview extends Agent {
  static options = { sendIdentityOnConnect: false };
  initialState = { household: "h1", account: "u1", person: "p1", phase: "open", version: 1 };
  shouldSendProtocolMessages() {
    return false;
  }
  shouldConnectionBeReadonly() {
    return true;
  }
  async allowed(account) {
    return (
      account === this.state.account &&
      (await admitted(this.env, account, this.state.household, this.state.person))
    );
  }
  async onConnect(connection, ctx) {
    connection.setState({ account: ctx.request.headers.get("x-probe-account") });
  }
  async onMessage(connection) {
    if (!(await this.allowed(connection.state.account))) {
      connection.close(1008, "Access denied");
      return;
    }
    connection.send(JSON.stringify({ phase: this.state.phase, version: this.state.version }));
  }
  async onRequest(request) {
    if (!(await this.allowed(request.headers.get("x-probe-account"))))
      return new Response("Not found", { status: 404 });
    const action = new URL(request.url).pathname;
    if (action === "/complete" && this.state.phase === "open")
      this.setState({ ...this.state, phase: "completed", version: this.state.version + 1 });
    if (action === "/reopen") return new Response("Not allowed", { status: 409 });
    return Response.json(this.state);
  }
}
export default {
  async fetch(request, env) {
    const account = request.headers.get("x-probe-account");
    // Test-only authority administration is absent from any product proposal.
    if (new URL(request.url).pathname === "/test/authority") {
      await env.AUTH.put(account, await request.text());
      return new Response("ok");
    }
    if (!(await admitted(env, account, "h1", "p1")) || account !== "u1")
      return new Response("Not found", { status: 404 });
    const agent = await getAgentByName(env.HOUSEHOLD, "h1");
    return routeSubAgentRequest(request, agent, {
      fromPath: "/sub/private-interview/opaque-session-a" + new URL(request.url).pathname,
    });
  },
};
```

```javascript
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
await build({
  entryPoints: ["boundary.js"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "boundary-bundle.mjs",
  external: ["cloudflare:*", "node:*"],
});
function runtime() {
  return new Miniflare({
    modules: true,
    scriptPath: "boundary-bundle.mjs",
    compatibilityDate: "2026-07-14",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { HOUSEHOLD: { className: "HouseholdAgent", useSQLite: true } },
    durableObjectsPersist: "./boundary-storage",
    kvNamespaces: ["AUTH"],
    kvPersist: "./authority-storage",
  });
}
let mf = runtime();
async function request(path, account = "u1", options = {}) {
  return mf.dispatchFetch("https://probe.test" + path, {
    ...options,
    headers: { "x-probe-account": account, ...options.headers },
  });
}
async function authority(account, household, person, active = true) {
  assert.equal(
    (
      await request("/test/authority", account, {
        method: "PUT",
        body: JSON.stringify({ household, person, active }),
      })
    ).status,
    200,
  );
}
try {
  await authority("u1", "h1", "p1");
  await authority("u2", "h1", "p2");
  await authority("u3", "h2", "p3");
  const first = await (await request("/")).json();
  assert.equal(first.account, "u1");
  for (const account of ["u2", "u3", "unknown"])
    assert.equal((await request("/", account)).status, 404);
  console.log("PASS participant / other-adult / other-household / opaque-reference denial");
  const upgrade = await request("/", "u1", { headers: { Upgrade: "websocket" } });
  assert.equal(upgrade.status, 101);
  const ws = upgrade.webSocket;
  ws.accept();
  const frames = [];
  ws.addEventListener("message", (event) => frames.push(event.data));
  const waitFrame = () =>
    new Promise((resolve) =>
      ws.addEventListener("message", (e) => resolve(e.data), { once: true }),
    );
  let reply = waitFrame();
  ws.send("inspect");
  assert.equal(JSON.parse(await reply).phase, first.phase);
  reply = waitFrame();
  ws.send(JSON.stringify({ type: "cf_agent_state", state: { phase: "evil" } }));
  assert.equal(JSON.parse(await reply).type, "cf_agent_state_error");
  assert.equal((await (await request("/")).json()).phase, first.phase);
  console.log("PASS SDK state-sync mutation blocked with public readonly hook");
  await authority("u1", "h1", "p1", false);
  const closed = new Promise((resolve) =>
    ws.addEventListener("close", (e) => resolve(e.code), { once: true }),
  );
  ws.send("inspect");
  assert.equal(await closed, 1008);
  assert.equal((await request("/", "u1", { headers: { Upgrade: "websocket" } })).status, 404);
  console.log("PASS live message recheck closes departed participant; reconnect denied");
  await authority("u1", "h1", "replacement-person");
  assert.equal((await request("/")).status, 404);
  await authority("u1", "h1", "p1");
  const completed = await (await request("/complete")).json();
  assert.equal(completed.phase, "completed");
  assert.equal((await request("/reopen")).status, 409);
  await mf.dispose();
  mf = runtime();
  assert.deepEqual(await (await request("/")).json(), completed);
  console.log("PASS unlink denial; completed metadata retained read-only across runtime restart");
} finally {
  await mf.dispose();
}
```
