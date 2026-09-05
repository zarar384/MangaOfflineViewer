# AI Workflow

## Before implementation

Do not edit until each of these is answered:

1. Affected subsystem, from architecture.md.
2. Existing implementation and its direct callers.
3. Source of truth for the data involved.
4. Existing abstraction that already covers the behavior.
5. Persistence impact, including schema, indexes, and migrations.
6. Backward compatibility impact for stored data and for previously exported files.
7. Invariants the change touches.
8. The validation command that will prove the change.

If the behavior already exists somewhere, extend it instead of adding a parallel implementation. If the request conflicts with an invariant, say so before writing code.

## Investigation playbooks

### Service change

Find all injectors and callers. Confirm whether the service is root-provided or component-scoped. Check which signals other code reads before changing their shape or timing. Check whether the same workflow is reachable from another service.

### Repository or database change

Read the entity in `core/models`, then every `version(n).stores(...)` block touching the table, then all repository queries using the affected index or field, then their callers. Decide whether a new schema version and migration are required and whether existing user databases survive without one.

### Component change

Read the template together with the class. Check inputs, outputs, and any `Subject` driven parent contract such as `saveAll$` and `clearAll$`. Check whether the component injects repositories directly and keep that pattern. Verify signal usage and subscription cleanup.

### Import or export change

Trace the whole path in one pass: source data, serialization, physical format writing, detection, extraction, ordering, persistence, and fallback. Compare against legacy files that carry no metadata. Confirm the metadata contract stays format independent.

### Reader change

Read `web/src/app/features/reader/README.md` first. Identify the owning engine service. Check guard flags, `loadToken` and `navToken`, window sizing, eviction radius, and blob URL release before editing the component.

### New feature

Locate the closest existing feature and mirror its placement. Decide the layer from architecture.md, choose the owning state service, and confirm no repository or shared helper already provides the data access needed.

## Before finishing

1. Existing behavior reviewed, including paths you did not intend to change.
2. Backward compatibility reviewed for stored data and for previously exported files.
3. Relevant invariants rechecked.
4. No new abstraction introduced without a stated reason.
5. No unrelated refactoring, renaming, or formatting churn.
6. `npx ng build` run from `web/` and passing.
7. `git diff` reviewed for unintended edits, `git diff --check` clean, `git status --short` reviewed.
8. `.ai` updated only where a verified fact changed.