# One CLI tool in an isolated Linux environment

**Expose only one tool to the coding agent's LLMs: `cli`. All its commands run inside an isolated Linux environment.** This is the proposed tool design for the new agent.

The agent uses CLI commands to list and search files, read code, apply edits, inspect diffs, and run registered checks. Do not expose separate file-reading, file-writing, or host-shell tools.

```text
Focused LLM assignment
  → cli tool
  → Permission and limit checks
  → Isolated Linux environment
  → Command output and exit status
  → Validated result saved by the host
```

## The Linux environment

Create a separate Linux container or equivalent sandbox for each run, with its own working copy of the selected Cognition Panel project. Prepare the project's required runtimes and dependencies there.

Commands cannot run on the user's host or access unrelated projects, host credentials, or the container-management socket. Dependency installation uses the project's approved network and dependency settings.

Keep the working copy and its identity available while a run waits for human review, so it can resume after a worker restart. Return the final diff for conflict-aware delivery to the original project.

## One tool, different permissions

The same `cli` tool has different permissions for each assignment. The host sets them; the LLM cannot increase them.

| Assignment | Allowed work |
| --- | --- |
| File discovery | List and search file names only |
| Investigation and answer-only | Read the selected project files; no project edits |
| Planning and model review | Read the evidence needed for the assignment; no project edits |
| Test writing | Change only the assigned test files and fixtures |
| Skeleton creation | Make only the approved declaration changes |
| Implementation | Change only the approved assignment scope |
| Guards and tests | Run the registered commands and collect their real results |

Enforce these limits at the execution boundary. Use read-only mounts or restricted workspace views for read-only jobs. For editing, stage changes and validate the diff before accepting it. Method-only and skeleton-only changes need language-aware checks. Checking a command's name alone is insufficient: scripts and subprocesses can also edit files.

Tests may need writable temporary and output directories; those do not grant permission to change project source. If isolation cannot be established, stop the command rather than falling back to the host shell.

Users can create deterministic guards, such as ESLint, in the coding-agent UI by configuring a command or script. Store these definitions in PostgreSQL per project and agent type. The host validates and registers them, then runs them through this same isolated CLI service. This adds no new LLM tool and requires no LLM call for a deterministic check. Record the actual exit status and output; a failed check returns to the workflow's bounded repair loop.

## Results and limits

Return bounded command output, exit status, and the working-copy revision. Save larger logs as artifacts. Apply timeouts, cancellation, and output limits, and stop subprocesses when the run is cancelled.

The host still owns workflow decisions, JEV calls, model calls, PostgreSQL memory, artifacts, and human approval. These are application services, not extra tools exposed to the LLM. A skill requests a human decision through its structured result; the host displays it, saves the answer, and resumes the assignment.

## Where to implement it

- **kushibot:** reusable CLI execution contracts and integration with execution limits, cancellation, and evidence.
- **Coding plugin:** assignment-specific CLI permissions, project commands, and change validation.
- **Cognition Panel host:** provision and retain the isolated Linux environment, configure it, and show output and approvals.

Reuse existing execution and workspace foundations where suitable. This document requires isolated Linux execution; verify the current adapters meet it before reusing them.

See the [main workflow](coding-agent-workflow.md) and the [answer-only path](answer-only-fast-path.md).
