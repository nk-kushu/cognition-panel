# LLM skill scheduler in kushibot

**Build the skill scheduler as a reusable part of the kushibot library. It uses an LLM, and the host can select a custom model for scheduling.** The coding plugin supplies its skills and calls the scheduler inside the relevant workflow steps. Other agents can use the same library capability.

This describes new functionality to implement, not an existing scheduler API.

Load skill definitions from PostgreSQL for the current **Cognition Panel project ID and agent type**. Users can add and edit skills in the coding-agent plugin UI. The host passes the run's fixed versions of those definitions into the library scheduler; the scheduler does not depend on a hardcoded coding-skill catalog.

## What the scheduler does

The scheduler answers one question: **“Which skill should run next for this task?”**

It receives the current workflow phase, the goal, short descriptions of available skills, their dependencies, and summaries of completed results. It chooses the next skill and explains the choice briefly. The chosen skill then runs in its own focused session with its full instructions.

The scheduler model chooses the work. The model assigned to the skill performs that work. They can use the same model or different models, but their sessions have separate assignments.

## A simple example

During planning, these skills are available:

1. **Find packages** — discovers suitable packages.
2. **Design the code** — needs the package decision first.
3. **Check the design** — needs a finished design.

```text
Scheduler LLM chooses “Find packages”
      ↓
Skill runs and presents options
      ↓
User chooses a package; the answer is saved
      ↓
Scheduler LLM chooses “Design the code”
      ↓
Skill runs using the chosen package
      ↓
Scheduler LLM chooses “Check the design”
      ↓
Skill reviews the design
      ↓
Code confirms the step's required results are complete
```

While waiting for the user, pause through the shared human-decision mechanism. The scheduler must not keep calling the model to ask whether an answer has arrived.

## How ordering works

Each skill declares its phase, purpose, required inputs, and expected result. Code filters out skills that are disabled, outside the current phase, or missing required inputs. The scheduler LLM chooses from the eligible skills based on the current goal and findings.

Code validates the choice before executing it. The LLM cannot bypass dependencies, skip required skills, approve itself, or increase retry limits. Missing inputs and circular dependencies must be reported. A request for more information goes through the workflow's return paths.

After a skill finishes, save and validate its result, then let the scheduler choose the next skill. Run one assignment at a time. If the scheduler proposes finishing, code checks that all required results and checks are complete first.

Keep small guidance rules, such as “Keep helper methods private,” with the relevant skill assignment. They do not each need a separate scheduling decision or model call.

## Selecting the scheduler model

Add a separate **Skill scheduler model** setting in Cognition Panel. The host passes its model gateway and profile into the kushibot scheduler. It can differ from the investigation, implementation, and guard models.

Pin this choice for the run. Scheduler calls share the run's budget, cancellation, and time limits. Limit scheduling attempts and stop with a clear reason when the model repeatedly returns invalid choices or makes no progress.

## What belongs where

- **kushibot:** reusable scheduler, LLM decision contract, dependency checks, decision validation, and integration with existing execution, storage, and recovery capabilities.
- **Coding plugin:** coding skill definitions, phase-specific context, and the tools and checks used to execute each skill.
- **Cognition Panel:** scheduler model setting, progress display, and human-decision UI.

Save scheduling decisions, completed results, and pending requests so a resumed run continues from recorded progress. Use kushibot's workflow engine for transitions and waiting rather than creating a second workflow engine.

The nine main steps remain defined in the [coding-agent workflow](coding-agent-workflow.md). The LLM skill scheduler organizes focused skill assignments inside those steps.
