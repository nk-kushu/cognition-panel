# Answer-only fast path

Use this path when the user wants an explanation, such as “How does login work?” or “Where is this function used?”

The workflow starts with **Step 0: Choose request mode**. It respects an explicit user choice or uses the **JEV DecisionUnit** to choose answering or changing code. This decision is saved inside the workflow state machine. If unclear, the workflow waits for a user clarification, with at most 2 clarification returns by default.

```text
Step 0 selects the answer-only branch
  → Understand the question
  → Read relevant context and project memory
  → Find and read more files only if needed
  → Give a simple answer with source links
```

## Workflow behavior

Use existing conversation evidence when it is sufficient. For claims about the current code, check that the evidence is still current; project memory alone may be stale. Investigate only the questions needed for the answer, using the same focused investigation components as the coding workflow.

Implement this as the answer-only branch selected by Step 0 in the workflow state machine, with preparation, optional investigation, and answer steps. Keep the mode decision, branch progress, and waiting states in the same run. Use `StructuredTaskExecutor`, read-only session bindings, and validated results. Preparation and transition policies can skip investigation when sufficient evidence already exists. The answer includes relevant file references and clearly identifies unresolved points.

Final answers must be simple, short, and structured. For a function question, explain **what it does**, **where it is used**, and a **real-life example in numbered steps**. Trace actual callers and link the source. Use realistic illustrative inputs, but base the sequence and behavior on inspected code. If usage cannot be verified, say so instead of inventing an example call chain.

This path does not run implementation planning, test writing, skeleton review, code editing, or code-change guards/tests. Its only exposed tool is `cli`, running with read-only project access inside the [isolated Linux environment](tools-and-linux-environment.md). The host may still save run records and labeled evidence artifacts. Use only question-answering skills when needed; simple questions can bypass skill scheduling.

Allow an optional answer-model selection that otherwise inherits the agent's default. All answer and investigation calls share the run budget. The proposed fast-path limit is 3 investigation rounds, also bounded by time, tokens, and model calls. Stop with a clear explanation when evidence remains insufficient.

If the answer reveals a needed code fix, explain it and wait for a user request to make the change. Do not silently switch an answer-only run into an editing run.

File discovery uses JEV selection. The fast-path investigation limit must be editable in the coding-agent plugin UI, saved per project, and fixed for each run.

## Keep the answer simple and structured

Start with the direct answer. Use short sentences, familiar words, and only the details needed to understand it. Prefer a few bullets or numbered steps over a long technical explanation.

For questions about a function, use this format:

- **What it does:** one simple sentence.
- **Where it is used:** link to its definition and the relevant callers or entry points.
- **Real-life example:** explain one realistic action, step by step, from the user's action to the result.

For example, a question about `validateToken` could be answered like this, **if the inspected code supports this flow**:

> **What it does:** checks whether a password-reset link is still valid.
>
> **Where it is used:** the password-reset handler calls it before changing the password. Link the actual function and caller here.
>
> **Real-life example:**
> 1. Maria opens her password-reset link and submits a new password.
> 2. The reset handler receives the token from that link.
> 3. The handler calls `validateToken(token)`.
> 4. The function checks the token and its expiry.
> 5. If valid, the handler continues with the password change. Otherwise, it rejects the request.

Trace the actual callers before explaining usage. Mark invented names and sample values as illustrative; do not invent calls or behavior. If no caller is found, say so. Include a short code example only when it makes the explanation easier.

See the [main coding-agent workflow](coding-agent-workflow.md) for the overall flow and shared loop limits.
