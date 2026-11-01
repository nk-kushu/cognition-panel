# Coding agent plugin

This package is registered by [`kushex-plugin.json`](kushex-plugin.json) as **Coding Agent**
and contributes agent `coding`. Cognition Panel discovers it through `KUSHEX_PLUGINS_DIR`.

The agent runs as a kushibot workflow. It either answers a question read-only or takes a
code change through investigation, planning, tests, a skeleton you approve, implementation,
guards and tests. The design is in
[`docs/ideas/coding-agent`](../../docs/ideas/coding-agent/coding-agent-workflow.md).

## Folder structure

- `agent.ts`: entry point; exports `chat` and the public API.
- `ui.tsx`, `ui/`: browser-only workflow graph, settings, Skills, Guards and Memory panels.
- `src/composition/`: builds one run's agent.
- `src/workflow/`: the state machine, step executor and the policies that enforce limits.
  `WorkflowGraph.ts` is the browser-safe map of steps and returns: the engine builds its
  transitions from it and the UI draws it, so the picture cannot drift from what runs.
- `src/steps/`: one folder per stage: `mode`, `answer`, `investigation`, `planning`, `tests`,
  `skeleton`, `review`, `editing`, `guards`, `verification`.
- `src/assignments/`: runs one focused assignment in its own session.
- `src/context/`: durable run state, shared context and labeled artifacts.
- `src/engineering/`: settings and definition types, the skill phase runner, starter catalog.
- `src/tools/`: `cli`, the only tool a model receives.
- `src/infrastructure/`: sandbox, working copy, language checks, run files and JEV.
- `src/integrations/kushex/`: chat request translation.
- `tests/`: scripted-model tests against real isolated commands.

## The workflow

Steps form one chain, because kushibot requires a return to target an earlier step and every
step to be accepted. Steps of the branch not selected finish without doing any work.

| Step                                                   | Work                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `mode`                                                 | Honors an explicit choice, otherwise asks JEV. Waits for clarification if unclear. |
| `answer-prepare`, `answer-investigate`, `answer-write` | The read-only answer branch.                                                       |
| `plan-investigation`                                   | One session lists the questions to answer.                                         |
| `investigate`                                          | For each question: names only, JEV selection, then reading the selected files.     |
| `plan-implementation`                                  | Runs scheduled skills, then produces the plan.                                     |
| `write-tests`                                          | One session per behavior; may touch only its test files.                           |
| `skeleton`                                             | One session per component; declarations only.                                      |
| `human-review`                                         | No model. Waits for approval of the exact version shown.                           |
| `implement`                                            | One session per change; only the assigned method bodies may change.                |
| `guards`                                               | Runs saved commands and model reviews through kushibot's guard framework.          |
| `run-tests`                                            | Runs registered suites directly.                                                   |

A step sends a run back with a `needs-return` result. Workflow code, not a model, decides
whether that happens: `ReturnAllowance` counts the engine's own transition records, so
restarts and resumes cannot reset a limit. Later steps reuse whatever is still valid, so a
return repeats only what it affects: finished assignments are skipped, a kept plan keeps its
tests, skeleton and approval, and blocked work continues with the new finding.

## What runs where

The agent runs in its own Node process, which has **no database access**.

- **At launch** the server loads this project's settings, skills, guards and memory from
  PostgreSQL and passes them in `request.host`. The run saves them as `pinned.json`, so
  later edits never reach it.
- **During the run** its files live in `KUSHEX_RUNS_DIR/<run>/`: `pinned.json`, `state.json`,
  `run.sqlite` (workflow and usage) and `workspace/`.
- **To wait** the process ends. `chat` returns `presentation: "wait"`; the server saves the
  request as an `AgentRunWait` row; the chat shows it, including after a reload.
- **To resume** the server validates the answer against what was asked, claims the row and
  starts a new process with `request.resume`, which calls `agent.resume`. Starting another
  run is not a resume. Waiting time does not count against the run's working time.

A process that dies mid-step is not resumed: a waiting run survives a restart, but a run
that is actively working fails, with its counters and working copy kept on disk.

## Isolation

Every command runs in Bubblewrap with no network and only what the host mounts. On macOS or
Windows that means the backend container. If isolation cannot be established the command
does not run; there is no host-shell fallback.

| Assignment                      | What it can see and change                                            |
| ------------------------------- | --------------------------------------------------------------------- |
| File discovery                  | Empty placeholder files: names can be searched, contents do not exist |
| Investigation, answers          | Only the selected files, read-only                                    |
| Planning, skills                | The whole working copy, read-only                                     |
| Tests, skeleton, implementation | A staged copy, validated and merged only on acceptance                |
| Guards, tests                   | A throwaway stage; changing existing source fails the check           |

Limits apply to what actually changed, whatever command changed it. Writes outside an
assignment are restored straight away. TypeScript and JavaScript files also get
language-aware checks: a skeleton may only add stubs, and implementation may only change the
assigned bodies. Other languages get path limits only, and the review panel lists those files.
Adding a dependency to `package.json` requires the user's recorded approval.

The run edits its own copy, without `.git`, and dependencies are mounted read-only. The
original project changes only when you apply the resulting proposal, which fails with
`TARGET_CHANGED` if the files moved on in the meantime.

## Configuration

Run `codex login` on the host first. Models come from Codex CLI; the backend reads
`CODEX_MODEL`, `CODEX_HOME` and optional `CODEX_EXECUTABLE`.

JEV is TypeSafe's `systemOne` API. Set `KUSHEX_JEV_API_KEY`, and optionally `KUSHEX_JEV_MODEL`
(default `jev-latest`) and `KUSHEX_JEV_BASE_URL`. Without it, automatic mode selection fails
with an explanation rather than guessing; choosing Explain or Change in the composer still
works. File selection and optional guards then keep every candidate.

Open **Configure** in the chat for the rest. All of it is saved per project and agent type:

- **Workflow**: the state machine as a graph. Select a step or a coloured return path to edit
  only what controls it: its limits, models, skills and guards. Limits and models wait for
  _Save_; a skill or guard change saves a new version straight away.
- **Limits**: returns by category, total returns, answer rounds, working time, model calls
  and tokens. Validated in the backend as well as the UI.
- **Models**: a default plus overrides for investigation, implementation, guard review, the
  skill scheduler and answers. A skill or guard can name its own model.
- **Tests**: the test-writing prompt, test types, and the suites that run them. With no type
  selected, tests are written but not run, and the result says so. A selected type with no
  enabled suite stops a code change as blocked verification before tests are written.
- **Skills** and **Guards**: created in the UI and versioned. _Add built-in_ copies the starter
  catalog into the project. A skill with an empty expected result is short guidance sent with
  its phase's assignments; one with an expected result gets its own scheduled session.
  A skill runs once in each of its phases, can require run results (`findings`, `plan`, `tests`,
  `skeleton`, `approval`), and its result is checked against the expected result. The `answer`
  phase covers the read-only branch; questions that need no investigation skip scheduling.
  A guard runs on the skeleton before review, on the finished change, or both. Skeleton
  findings use the skeleton revision limit.
- **Memory**: this project's preferences. Answers can be saved here with _Remember for this
  project_. A preference guides the agent; it does not enforce anything by itself.

## Limits inherited from change review

Reviewed files must be regular UTF-8 text up to 64 KiB, and a change is limited to 16 files.
Each model action is limited to 16 KiB. The sandbox has no network, so a newly approved
dependency is not installed and tests that need it fail until it is added to the project.

## Validation

From `kushex`:

```sh
pnpm typecheck:agent:coding
pnpm test:agent:coding:container
```

The tests need Linux with Bubblewrap, so the container script is the normal way to run them.
It builds a test image, runs the suite under the sandbox's seccomp profile, then checks that
Docker's default restrictions make the sandbox fail closed. Models and JEV are scripted, so
no paid calls occur; the commands are real.

### OpenRouter models

Save an encrypted OpenRouter API key in **Cognition Panel Settings → OpenRouter**, then use
the coding agent’s **Configure → Models** tab to select live catalog models per role. Blank roles inherit the default;
Codex CLI model names continue to work. See [OpenRouter setup](../../docs/openrouter.md)
for the server encryption key, database migration, and credential lifecycle.
