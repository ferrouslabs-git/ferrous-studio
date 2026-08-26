# CLAUDE.md — Project Conventions

## Language

Use **British English** throughout all user-visible text, code comments, and documentation.

Key conventions:
- "organisation" not "organization"
- "colour" not "color" (in comments/docs — CSS property names must stay as `color`)
- "authorise" not "authorize"
- "recognise" not "recognize"
- "analyse" not "analyze"
- "licence" (noun) / "license" (verb)
- "centre" not "center" (in text — CSS values must stay as `center`)
- Double consonants in past tenses: "cancelled", "labelled", "modelled"

> **Note:** CSS property names, SVG attributes, and web-standard values (`color`, `text-align: center`, `currentColor`) are part of the W3C spec and must remain in their standardised American-English form. URL routes and code identifiers (variable/function names) are also excluded — only user-visible strings and comments follow this rule.

## Infra

Read `infra/docs/onboarding-runbook.md` before touching AWS resources by
hand. `infra/terraform/` (Terraform — `terraform apply`) owns the
Cognito/RDS/ECR/IAM/security-group/target-group resources; `deploy-*.ps1`/`.sh`
build, push, migrate and deploy per environment, reading Terraform's outputs.
Prefer re-running these over changing resources by hand.
`app.config.json` is the single source of truth for the product name/domain
both Terraform and the scripts use — don't hardcode the product name
elsewhere.
