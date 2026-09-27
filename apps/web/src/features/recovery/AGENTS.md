# Password recovery screens

Own reset-request and new-password forms. Use the public [auth boundary](../auth/AGENTS.md) and the existing typed operations in this feature. Passwords and tokens remain transient; do not put them in retained-request storage.

After reset, clear the token from the URL and require login. Preserve invalid-link, validation, rate-limit, and safe-return-path behavior. Request success is not proof that a reset email was delivered: the server's mail callback defaults to a mock.

Use [the authentication map](../../../../../docs/reference/features/auth-family/authentication.md) and recovery tests for expected behavior. Coordinate native reset changes with [server auth](../../../../api/src/features/auth/AGENTS.md).
