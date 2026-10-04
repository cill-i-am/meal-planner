# Domain configuration for agent skills

Use the [feature map](../reference/features/README.md) to find the affected domain,
contract, local instructions and verification. Product language belongs in the
[product domain](../reference/product-domain.md); engineering language belongs in
the [engineering vocabulary](../reference/engineering/VOCABULARY.md).

When a skill says `GLOSSARY.md` or `GLOSSARY-MAP.md`, use these existing references.
Update the owning reference when an agreed term changes. Do not create another
glossary or rename real services/APIs to satisfy an imported vocabulary rule.

ADRs and PDRs live in the [decision register](../decisions/README.md). Preserve its
identifiers, template and approval evidence. Routine implementation choices need
no decision record. A material change to domain ownership, product meaning or
accepted privacy/data policy returns to Cillian when outside the agreed direction.

Code, schemas and tests establish implemented behavior. Planned product concepts
and historical decisions must not be presented as completed features.
