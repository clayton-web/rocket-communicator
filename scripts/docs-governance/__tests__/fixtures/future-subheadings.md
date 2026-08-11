# Decision register (fixture)

The alternative heading-record field syntax: nested sub-headings instead of bold labels. D165
fixes the schema but not the markup, so the harness reads either until batch one settles which
one the register uses.

## Decisions

### D001 — Repository separation

#### Status

Approved

#### Decision

the fixture repository is separate. Rocket must **not** share a deployment target with any other product.

#### Notes

Origin note preserved. This does **not** authorize any deployment change.

### D002 — Escaped pipe carrier

#### Status

Approved

#### Decision

no `kept | assigned` enum, outcome table, or custody model is required; the persistence representation stays deliberately **unsettled**.

#### Notes

Complements D001. Retention detail lives in [DATA_RETENTION.md](DATA_RETENTION.md).
