# Engineering standards

These standards explain how to model data, divide responsibilities, handle errors
and test changes in Meal Planner. Before implementing or reviewing code, read this
index and the topics that apply. Give coding subagents the same links.

Keep the rules for valid data close to the code that creates or changes it. Parse
untrusted data when it enters the system, then pass the parsed value to the code
that uses it. Make it clear which component owns each value and which failures a
caller needs to handle.

This is a greenfield app. Follow the requirements, but replace a poor design when
needed. Update its callers rather than keeping backward-compatible shims, legacy
guards or parallel paths. Keep validation, access control and data-safety checks.

Prefer straightforward code within a feature and small interfaces with a real
purpose. Use a reliable, secure library when it meets the need; use its supported
extension points before writing a replacement. Pure calculations can be ordinary
functions. Effect handles backend work with external effects and resource lifetimes.
Check current official documentation against the installed package version.

| When changing… | Read… |
| --- | --- |
| Valid values, branded types or state transitions | [Domain modeling](DOMAIN_MODELING.md) |
| Parsing, serialization or data-transfer objects | [Boundaries](BOUNDARIES_AND_PARSING.md) |
| Data, cache or state ownership | [Data flow](DATA_FLOW_AND_STATE.md) |
| Expected failures or defects | [Errors](ERROR_HANDLING.md) |
| Logging or tracing | [Observability](OBSERVABILITY.md) |
| Feature boundaries or public exports | [Feature slices](FEATURE_SLICE_ARCHITECTURE.md) |
| Dependencies, interfaces or adapters | [Modules](DESIGNING_MODULES.md) |
| Cancellation, transactions or retries | [Async workflows](ASYNC_AND_WORKFLOWS.md) |
| Tests or runtime checks | [Testing](TESTING_AND_VERIFICATION.md) |
| Type assertions or public types | [TypeScript](TYPESCRIPT_CONTRACTS.md) |
| Workers, Durable Objects, storage or queues | [Cloudflare](CLOUDFLARE_ARCHITECTURE.md) |
| Effect integration | [Effect conventions](EFFECT.md) |
| An unfamiliar term in these standards | [Vocabulary](VOCABULARY.md) |

## Reading and enforcement

The thirteen topic documents retain the original coding-standards library's rules
and examples. The `coding-standards` skill is another route to the same pages, not
a separate copy. Examples teach a pattern; they do not claim that every helper or
folder shown already exists. Check the actual code and installed version.

Apply these standards to the work you are doing. They are not a requirement to
audit unchanged code or ask for approval for routine choices. Add tests only when
they give useful confidence or prevent regressions; do not add redundant checks or
unjustified release gates.

Types, lint rules, architecture checks and behavior tests enforce the rules they
can express. The documentation checker verifies that the links work. Neither a
link nor a passing checker proves that an agent read or followed a page.
