# AI Engineering Context

Local knowledge base for MangaOfflineViewer, verified against the source code.
`AGENTS.md` in the repository root carries the minimal committed rules. This directory carries the detailed context behind them and is git-ignored.

Read the relevant document before changing code.

| Question | Document |
| --- | --- |
| What the project is and what runs where | [project-overview.md](project-overview.md) |
| Subsystems, dependency boundaries, source of truth, invariants | [architecture.md](architecture.md) |
| Where code belongs | [project-structure.md](project-structure.md) |
| What must and must not be done when changing code | [development-rules.md](development-rules.md) |
| Non-obvious behavior, traps, known discrepancies | [implementation-notes.md](implementation-notes.md) |
| How to investigate and finish a change | [ai-workflow.md](ai-workflow.md) |
| Export/import (MHTML, ZIP/CBZ) streaming architecture, format details, memory model | [export-import.md](export-import.md) |

Overview, architecture, structure, and notes state facts about the current repository.
Development rules and workflow state instructions. Keep the two kinds of content separate.

Maintenance rules for this directory:

- Each fact has one owning document. Do not restate the same rule in several files.
- Verify against source before writing. Label anything inferred as inferred.
- Delete notes once the implementation they describe no longer exists.