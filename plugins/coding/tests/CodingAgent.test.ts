import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRequest } from "kushibot";
import type { GuardDefinition, SkillDefinition } from "../src/engineering/types";
import { defaultCodingSettings } from "../src/engineering/types";
import { CodingHarness, defaultDecisions } from "./fixtures/CodingHarness";
import { ScriptedGateway, cli, done, final, observation } from "./fixtures/ScriptedGateway";

const QUESTIONS = "Decide what must be understood";
const PREPARE = "Work out what must be checked";
const DISCOVER = "Propose the project files";
const READ = "Read the selected files";
const CHECK = "Check whether the findings";
const PLAN = "Decide what to build";
const TESTS = "Write tests for one planned behavior";
const SKELETON = "Create the proposed structure";
const IMPLEMENT = "Implement one small change";
const REPAIR = "Fix the problem in this failure report";
const ANSWER = "Answer the user simply";

const SOURCE = "src/token.ts";
const TEST_FILE = "src/token.test.ts";
const STUB = `export const version = 1;

export function validateToken(token: string): boolean {
  throw new Error("Not implemented");
}
`;
const IMPLEMENTED = STUB.replace('throw new Error("Not implemented");', "return token.length > 0;");

const write = (file: string, content: string) =>
  cli(`mkdir -p $(dirname ${file}) && cat > ${file} <<'KUSHEX_EOF'\n${content}KUSHEX_EOF`);

const plan = {
  summary: "Add validateToken.",
  tests: [{ id: "t1", behavior: "Empty tokens are invalid", type: "unit", files: [TEST_FILE] }],
  components: [
    {
      id: "c1",
      description: "Validation",
      file: SOURCE,
      signatures: ["validateToken(token: string): boolean"],
    },
  ],
  changes: [
    { id: "m1", description: "Validate the token", file: SOURCE, symbols: ["validateToken"] },
  ],
  packages: [],
};
const reading = {
  answered: true,
  answer: "Tokens live in src/token.ts.",
  sources: [SOURCE],
  missing: "",
};

/** Every session of one straight-through code change. */
const happyPath = (overrides: Readonly<Record<string, readonly unknown[]>> = {}) => ({
  [QUESTIONS]: [done({ questions: [{ question: "Where are tokens?", why: "To change them." }] })],
  [DISCOVER]: [cli("find . -type f"), done({ paths: [SOURCE] })],
  [READ]: [cli(`cat ${SOURCE}`), done(reading)],
  [CHECK]: [done({ verdict: "ready", question: "" })],
  [PLAN]: [done(plan)],
  [TESTS]: [write(TEST_FILE, "test('x', () => {});\n"), done({ summary: "Added." })],
  [SKELETON]: [write(SOURCE, STUB), done({ summary: "Declared." })],
  [IMPLEMENT]: [write(SOURCE, IMPLEMENTED), done({ summary: "Implemented." })],
  ...overrides,
});

const suite = (script: string) => ({
  id: "unit",
  type: "unit",
  name: "Unit",
  command: "/bin/sh",
  args: ["-c", script],
  workingDirectory: ".",
  timeoutMs: 10_000,
  enabled: true,
});
const withTests = (script = "grep -q 'token.length' src/token.ts") => ({
  settings: { testTypes: ["unit"], testSuites: [suite(script)] },
});

test("answers a question read-only, without planning, and leaves the project alone", async (t) => {
  const gateway = new ScriptedGateway({
    [PREPARE]: [done({ questions: [{ question: "What is version?", why: "Asked." }] })],
    [DISCOVER]: [done({ paths: [SOURCE] })],
    [READ]: [
      cli(`echo changed > ${SOURCE}; cat ${SOURCE}`),
      (request: ModelRequest) => {
        const output = observation(request);
        assert.match(String(output.output), /Read-only|version/i);
        return done(reading);
      },
    ],
    [ANSWER]: [done({ answer: "**What it does:** holds the version." })],
  });
  const harness = await CodingHarness.create(t, gateway, {}, (request) =>
    request.purpose === "choose-request-mode" ? "answer-only" : defaultDecisions(request),
  );
  const value = await harness.send("How does the token version work?");
  assert.equal(value.presentation, "message");
  assert.match(value.message, /What it does/);
  assert.equal(await harness.original(SOURCE), "export const version = 1;\n");
  assert.deepEqual(gateway.remaining(), []);
  assert.equal(gateway.sessions(PLAN), 0);
});

test("an explicit choice skips JEV classification", async (t) => {
  const gateway = new ScriptedGateway({
    [PREPARE]: [done({ questions: [] })],
    [ANSWER]: [done({ answer: "Hello." })],
  });
  const harness = await CodingHarness.create(t, gateway);
  const value = await harness.send("Can you fix login?", { mode: "answer-only" });
  assert.equal(value.message, "Hello.");
  assert.ok(!harness.decisions.asked.includes("choose-request-mode"));
});

test("does not guess the mode when JEV is unavailable", async (t) => {
  const harness = await CodingHarness.create(t, new ScriptedGateway({}));
  harness.decisions.evaluate = async () => ({ status: "unavailable", code: "DOWN" });
  const value = await harness.send("Fix login");
  assert.equal(value.presentation, "message");
  assert.match(value.message, /not guessed/);
});

test("waits for clarification and stops at the limit", async (t) => {
  const gateway = new ScriptedGateway({});
  const harness = await CodingHarness.create(
    t,
    gateway,
    { settings: { limits: { ...defaultCodingSettings.limits, clarifications: 1 } } },
    () => "needs-clarification",
  );
  const first = await harness.send("login");
  assert.equal(first.presentation, "wait");
  assert.equal(first.wait?.kind, "clarification");
  const second = await harness.answer(first, { text: "hmm, not sure" });
  assert.equal(second.presentation, "message");
  assert.match(second.message, /clarification return limit/);
});

test("runs the whole workflow: approval, implementation, guards, tests, delivery", async (t) => {
  const gateway = new ScriptedGateway(happyPath());
  const guard: GuardDefinition = {
    id: "lint",
    versionId: "v1",
    name: "Lint",
    purpose: "Lints.",
    type: "deterministic",
    phases: ["guards"],
    selection: "required",
    blocking: true,
    reviewInstructions: "",
    model: "",
    check: {
      command: "/bin/sh",
      args: ["-c", "test -f src/token.ts"],
      script: "",
      workingDirectory: ".",
      timeoutMs: 10_000,
      successExitCodes: [0],
    },
  };
  const harness = await CodingHarness.create(t, gateway, { ...withTests(), guards: [guard] });
  const waiting = await harness.send("Add token validation");
  assert.equal(waiting.presentation, "wait", waiting.message);
  assert.equal(waiting.wait?.kind, "skeleton-review");
  assert.deepEqual(waiting.wait?.payload.notLanguageChecked, []);
  assert.equal(gateway.sessions(IMPLEMENT), 0, "Nothing is implemented before approval.");

  const finished = await harness.approve(waiting);
  assert.equal(finished.presentation, "changes", finished.message);
  assert.deepEqual([...finished.result!.changedPaths].sort(), [TEST_FILE, SOURCE].sort());
  assert.equal(finished.result!.changeArtifactRefs.length, 2);
  for (const ref of finished.result!.changeArtifactRefs) assert.ok(finished.artifacts[ref]);
  // Delivery is a proposal: the run edits its own copy, never the project.
  assert.equal(await harness.original(SOURCE), "export const version = 1;\n");
  assert.deepEqual(gateway.remaining(), []);
});

test("rejected skeletons return, and approval needs the new version", async (t) => {
  const revised = STUB.replace("boolean", "boolean | null");
  const gateway = new ScriptedGateway(
    happyPath({
      [SKELETON]: [
        write(SOURCE, STUB),
        done({ summary: "First." }),
        (request: ModelRequest) => {
          assert.match(request.messages[0]!.text, /Return null for bad tokens/);
          return write(SOURCE, revised);
        },
        done({ summary: "Second." }),
      ],
      [IMPLEMENT]: [
        write(SOURCE, revised.replace('throw new Error("Not implemented");', "return null;")),
        done({ summary: "Done." }),
      ],
    }),
  );
  const harness = await CodingHarness.create(t, gateway, withTests());
  const first = await harness.send("Add token validation");
  const second = await harness.answer(first, {
    choice: "request-changes",
    text: "Return null for bad tokens",
  });
  assert.equal(second.wait?.kind, "skeleton-review");
  assert.notEqual(second.wait?.payload.digest, first.wait?.payload.digest);
  const stale = await harness.answer(second, {
    choice: "approve",
    digest: String(first.wait!.payload.digest),
  });
  assert.equal(stale.presentation, "message");
  assert.match(stale.message, /does not match/);
});

test("code changes outside an assignment are restored, and skeleton bodies are refused", async (t) => {
  const gateway = new ScriptedGateway(
    happyPath({
      [SKELETON]: [
        write("src/other.ts", "export {};\n"),
        (request: ModelRequest) => {
          assert.match(String(observation(request).rejected), /src\/other\.ts/);
          return write(SOURCE, IMPLEMENTED);
        },
        done({ summary: "Declared." }),
        (request: ModelRequest) => {
          assert.match(request.messages.at(-1)!.text, /must have no implementation/);
          return write(SOURCE, STUB);
        },
        done({ summary: "Declared." }),
      ],
    }),
  );
  const harness = await CodingHarness.create(t, gateway, withTests());
  const waiting = await harness.send("Add token validation");
  assert.equal(waiting.wait?.kind, "skeleton-review", waiting.message);
  assert.ok(!(waiting.wait!.payload.files as string[]).includes("src/other.ts"));
});

test("implementation stays inside its method and keeps the signature", async (t) => {
  const changed = IMPLEMENTED.replace("token: string", "token: string, strict: boolean");
  const gateway = new ScriptedGateway(
    happyPath({
      [IMPLEMENT]: [
        write(SOURCE, changed),
        done({ summary: "Implemented." }),
        (request: ModelRequest) => {
          assert.match(request.messages.at(-1)!.text, /signatures and all other code are fixed/);
          return write(SOURCE, IMPLEMENTED);
        },
        done({ summary: "Implemented." }),
      ],
    }),
  );
  const harness = await CodingHarness.create(t, gateway, withTests());
  const finished = await harness.approve(await harness.send("Add token validation"));
  assert.equal(finished.presentation, "changes", finished.message);
});

test("a blocked assignment gets its answer and continues without repeating finished work", async (t) => {
  const twoChanges = {
    ...plan,
    changes: [
      { id: "m1", description: "First change", file: "src/first.ts", symbols: [] },
      { id: "m2", description: "Second change", file: SOURCE, symbols: ["validateToken"] },
    ],
  };
  const gateway = new ScriptedGateway(
    happyPath({
      // The skeleton changed the first finding's source, so that question is checked again.
      [DISCOVER]: [
        done({ paths: [SOURCE] }),
        done({ paths: [SOURCE] }),
        done({ paths: ["src/rules.ts"] }),
      ],
      [READ]: [
        done(reading),
        done(reading),
        done({
          answered: true,
          answer: "Tokens expire after use.",
          sources: ["src/rules.ts"],
          missing: "",
        }),
      ],
      [CHECK]: [done({ verdict: "ready", question: "" }), done({ verdict: "ready", question: "" })],
      [PLAN]: [done(twoChanges)],
      [IMPLEMENT]: [
        write("src/first.ts", "export const first = 1;\n"),
        done({ summary: "First." }),
        final({
          status: "needs-information",
          question: "Must reset tokens become invalid after use?",
          why: "It decides the check.",
          checked: [SOURCE],
          route: "repository",
        }),
        (request: ModelRequest) => {
          assert.match(request.messages[0]!.text, /Tokens expire after use/);
          assert.doesNotMatch(request.messages[0]!.text, /First change/);
          return write(SOURCE, IMPLEMENTED);
        },
        done({ summary: "Second." }),
      ],
    }),
  );
  const harness = await CodingHarness.create(t, gateway, withTests(), defaultDecisions, {
    "src/token.ts": "export const version = 1;\n",
    "src/rules.ts": "export const single = true;\n",
  });
  const finished = await harness.approve(await harness.send("Add token validation"));
  assert.equal(finished.presentation, "changes", finished.message);
  assert.equal(gateway.sessions(PLAN), 1, "The plan held, so it was not rewritten.");
  assert.ok(harness.decisions.asked.includes("plan-impact"));
  assert.deepEqual(gateway.remaining(), []);
});

test("a search that finds nothing new stops with the unresolved question", async (t) => {
  const gateway = new ScriptedGateway(
    happyPath({
      [DISCOVER]: [done({ paths: [SOURCE] }), done({ paths: [SOURCE] })],
      [READ]: [done({ answered: false, answer: "", sources: [], missing: "Not here." })],
      [CHECK]: [],
      [PLAN]: [],
      [TESTS]: [],
      [SKELETON]: [],
      [IMPLEMENT]: [],
    }),
  );
  const harness = await CodingHarness.create(t, gateway);
  const value = await harness.send("Add token validation");
  assert.equal(value.presentation, "message");
  assert.match(value.message, /no new evidence/);
  assert.match(value.message, /Where are tokens/);
  const state = await harness.state(value.runId);
  assert.equal(state.data.questions[0]?.status, "open");
});

test("failed tests return to repair, then guards and tests run again", async (t) => {
  const gateway = new ScriptedGateway(
    happyPath({
      [IMPLEMENT]: [
        write(SOURCE, STUB.replace('throw new Error("Not implemented");', "return false;")),
        done({ summary: "Wrong." }),
      ],
      [REPAIR]: [
        (request: ModelRequest) => {
          assert.match(request.messages[0]!.text, /Unit failed/);
          return write(SOURCE, IMPLEMENTED);
        },
        done({ summary: "Fixed." }),
      ],
    }),
  );
  const harness = await CodingHarness.create(t, gateway, withTests());
  const finished = await harness.approve(await harness.send("Add token validation"));
  assert.equal(finished.presentation, "changes", finished.message);
  assert.deepEqual(gateway.remaining(), []);
});

test("exhausted repairs stop as unresolved instead of completing", async (t) => {
  let attempt = 0;
  const failing = () => write(SOURCE, IMPLEMENTED.replace("0", String(++attempt)));
  const gateway = new ScriptedGateway(
    happyPath({
      [REPAIR]: [failing, done({ summary: "Tried." })],
    }),
  );
  const harness = await CodingHarness.create(t, gateway, {
    settings: {
      testTypes: ["unit"],
      testSuites: [suite("echo attempt $(date +%N); exit 1")],
      limits: { ...defaultCodingSettings.limits, codeFixReturns: 1 },
    },
  });
  const value = await harness.approve(await harness.send("Add token validation"));
  assert.equal(value.presentation, "message");
  assert.match(value.message, /code-fix return limit \(1\)/);
  assert.equal(value.result, null);
  const kept = await harness.kept(value.runId, SOURCE);
  assert.match(kept, /token\.length/, "Failed work stays in the run's copy for inspection.");
});

test("a missing test executable is blocked verification, not a code defect", async (t) => {
  const gateway = new ScriptedGateway(happyPath());
  const harness = await CodingHarness.create(t, gateway, {
    settings: {
      testTypes: ["unit"],
      testSuites: [{ ...suite(""), command: "not-installed", args: [] }],
    },
  });
  const value = await harness.approve(await harness.send("Add token validation"));
  assert.equal(value.presentation, "message");
  assert.match(value.message, /Verification is blocked|could not run|execvp/);
  assert.equal(gateway.sessions(REPAIR), 0);
});

test("skills are scheduled in order and a package needs the user's approval", async (t) => {
  const skill = (id: string, extra: Partial<SkillDefinition> = {}): SkillDefinition => ({
    id,
    versionId: `${id}-v1`,
    name: id,
    purpose: `The ${id} skill.`,
    instructions: `SKILL-${id} instructions.`,
    phases: ["planning"],
    dependencies: [],
    expectedResult: "A short result.",
    selection: "required",
    ...extra,
  });
  const withPackage = { ...plan, packages: ["left-pad"] };
  const harness0 = happyPath({
    [PLAN]: [done(withPackage)],
    [IMPLEMENT]: [
      write("package.json", '{"dependencies":{"other":"1.0.0"}}\n'),
      done({ summary: "Added." }),
      (request: ModelRequest) => {
        assert.match(request.messages.at(-1)!.text, /adding other needs the user's approval/);
        return write(SOURCE, IMPLEMENTED);
      },
      done({ summary: "Done." }),
    ],
    "SKILL-packages": [
      final({
        status: "needs-decision",
        question: "Which package?",
        findings: "left-pad fits.",
        recommendation: "left-pad",
        choices: [{ label: "left-pad", packages: ["left-pad"] }],
      }),
      (request: ModelRequest) => {
        assert.match(request.messages[0]!.text, /Which package/);
        return done({ summary: "Chose left-pad.", result: "left-pad" });
      },
    ],
    "SKILL-design": [done({ summary: "Designed.", result: "design" })],
  });
  const gateway = new ScriptedGateway(harness0);
  const files = { "src/token.ts": "export const version = 1;\n", "package.json": "{}\n" };
  const harness = await CodingHarness.create(
    t,
    gateway,
    {
      ...withTests(),
      skills: [skill("packages"), skill("design", { dependencies: ["packages"] })],
    },
    defaultDecisions,
    files,
  );
  const decision = await harness.send("Add token validation");
  assert.equal(decision.wait?.kind, "decision", decision.message);
  // Implementation changes package.json only if the plan says so; the check runs on any edit.
  const reviewed = await harness.answer(decision, { choice: "left-pad", packages: ["left-pad"] });
  assert.equal(reviewed.wait?.kind, "skeleton-review", reviewed.message);
});

test("a resumed run keeps its pinned settings and counters", async (t) => {
  const gateway = new ScriptedGateway(happyPath());
  const harness = await CodingHarness.create(t, gateway, withTests());
  const waiting = await harness.send("Add token validation");
  const before = await harness.state(waiting.runId);
  const assignments = Object.keys(before.data.assignments).length;
  assert.ok(assignments >= 4);
  const finished = await harness.approve(waiting);
  assert.equal(finished.presentation, "changes", finished.message);
  assert.equal(gateway.sessions(PLAN), 1, "Work before the wait is not repeated.");
  await assert.rejects(harness.state(waiting.runId), "A completed run clears its directory.");
});

const scheduledSkill = (id: string, extra: Partial<SkillDefinition> = {}): SkillDefinition => ({
  id,
  versionId: `${id}-v1`,
  name: id,
  purpose: `The ${id} skill.`,
  instructions: `SKILL-${id} instructions.`,
  phases: ["planning"],
  dependencies: [],
  expectedResult: "A short result.",
  selection: "required",
  ...extra,
});
const skillDone = done({ summary: "Done.", result: "result" });
const SCHEDULER = "You choose which skill runs next";

test("a skill or guard runs on its own model", async (t) => {
  const gateway = new ScriptedGateway(
    happyPath({
      "SKILL-own": [skillDone],
      "Review only the supplied changes": [{ verdict: "pass", findings: [] }],
    }),
  );
  const guard: GuardDefinition = {
    id: "review",
    versionId: "v1",
    name: "Review",
    purpose: "Reviews.",
    type: "llm",
    phases: ["guards"],
    selection: "required",
    blocking: true,
    reviewInstructions: "Check it.",
    model: "guard-model",
    check: null,
  };
  const harness = await CodingHarness.create(t, gateway, {
    ...withTests(),
    guards: [guard],
    skills: [scheduledSkill("own", { model: "skill-model" })],
  });
  const finished = await harness.approve(await harness.send("Add token validation"));
  assert.equal(finished.presentation, "changes", finished.message);
  assert.ok(harness.bound.includes("guardReview:guard-model"));
  assert.ok(harness.bound.includes("default:skill-model"));
});

test("a skill runs once in each of its phases", async (t) => {
  const gateway = new ScriptedGateway(happyPath({ "SKILL-both": [skillDone, skillDone] }));
  const harness = await CodingHarness.create(t, gateway, {
    ...withTests(),
    skills: [scheduledSkill("both", { phases: ["planning", "skeleton"] })],
  });
  const waiting = await harness.send("Add token validation");
  assert.equal(waiting.wait?.kind, "skeleton-review", waiting.message);
  assert.equal(gateway.sessions("SKILL-both"), 2);
});

test("after a wait the run continues the saved choice without asking the scheduler", async (t) => {
  const gateway = new ScriptedGateway(
    happyPath({
      // One reply only: asking again after the wait would be an unexpected model call.
      [SCHEDULER]: [{ next: "second", reason: "It comes first here." }],
      "SKILL-second": [
        final({
          status: "needs-decision",
          question: "Which one?",
          findings: "Two fit.",
          recommendation: "A",
          choices: [{ label: "A", packages: [] }],
        }),
        skillDone,
      ],
      "SKILL-first": [skillDone],
    }),
  );
  const harness = await CodingHarness.create(t, gateway, {
    ...withTests(),
    skills: [scheduledSkill("first"), scheduledSkill("second")],
  });
  const decision = await harness.send("Add token validation");
  assert.equal(decision.wait?.kind, "decision", decision.message);
  const reviewed = await harness.answer(decision, { choice: "A" });
  assert.equal(reviewed.wait?.kind, "skeleton-review", reviewed.message);
  assert.equal(gateway.sessions(SCHEDULER), 1);
  assert.deepEqual(gateway.failures, []);
});

test("a skill must produce its expected result", async (t) => {
  const gateway = new ScriptedGateway(
    happyPath({ "SKILL-real": [done({ summary: "Nothing.", result: "" }), skillDone] }),
  );
  const harness = await CodingHarness.create(t, gateway, {
    ...withTests(),
    skills: [scheduledSkill("real")],
  });
  const waiting = await harness.send("Add token validation");
  assert.equal(waiting.wait?.kind, "skeleton-review", waiting.message);
  assert.ok(!gateway.remaining().includes("SKILL-real"));
  assert.match(gateway.requests.at(-1) ? JSON.stringify(gateway.requests) : "", /result is empty/);
});

test("a required skill without its inputs is reported, not run", async (t) => {
  const gateway = new ScriptedGateway(happyPath());
  const harness = await CodingHarness.create(t, gateway, {
    ...withTests(),
    skills: [scheduledSkill("late", { requiredInputs: ["skeleton"] })],
  });
  const value = await harness.send("Add token validation");
  assert.equal(value.presentation, "message");
  assert.match(value.message, /late needs skeleton/);
});

test("a selected test type with no suite blocks verification before tests are written", async (t) => {
  const gateway = new ScriptedGateway(happyPath());
  const harness = await CodingHarness.create(t, gateway, { settings: { testTypes: ["unit"] } });
  const value = await harness.send("Add token validation");
  assert.equal(value.presentation, "message");
  assert.match(value.message, /Verification is blocked: no enabled suite runs unit/);
  assert.equal(gateway.sessions(TESTS), 0);
});

test("a skeleton guard's findings revise the skeleton before review", async (t) => {
  const revised = STUB.replace("boolean", "boolean | null");
  const gateway = new ScriptedGateway(
    happyPath({
      [SKELETON]: [
        write(SOURCE, STUB),
        done({ summary: "First." }),
        (request: ModelRequest) => {
          assert.match(request.messages[0]!.text, /Skeleton rule/);
          return write(SOURCE, revised);
        },
        done({ summary: "Second." }),
      ],
    }),
  );
  const guard: GuardDefinition = {
    id: "shape",
    versionId: "v1",
    name: "Skeleton rule",
    purpose: "Checks the shape.",
    type: "deterministic",
    phases: ["skeleton"],
    selection: "required",
    blocking: true,
    reviewInstructions: "",
    model: "",
    check: {
      command: "/bin/sh",
      args: ["-c", "grep -q 'boolean | null' src/token.ts"],
      script: "",
      workingDirectory: ".",
      timeoutMs: 10_000,
      successExitCodes: [0],
    },
  };
  const harness = await CodingHarness.create(t, gateway, { ...withTests(), guards: [guard] });
  const waiting = await harness.send("Add token validation");
  assert.equal(waiting.wait?.kind, "skeleton-review", waiting.message);
  assert.equal(gateway.sessions(SKELETON), 2);
});

test("answer skills run when the question needed investigation, and not otherwise", async (t) => {
  const skills = [scheduledSkill("trace", { phases: ["answer"] })];
  const investigated = new ScriptedGateway({
    [PREPARE]: [done({ questions: [{ question: "What is version?", why: "Asked." }] })],
    [DISCOVER]: [done({ paths: [SOURCE] })],
    [READ]: [cli(`cat ${SOURCE}`), done(reading)],
    "SKILL-trace": [skillDone],
    [ANSWER]: [done({ answer: "Answered." })],
  });
  const first = await CodingHarness.create(t, investigated, { skills });
  assert.equal((await first.send("What is it?", { mode: "answer-only" })).message, "Answered.");
  assert.equal(investigated.sessions("SKILL-trace"), 1);

  const simple = new ScriptedGateway({
    [PREPARE]: [done({ questions: [] })],
    [ANSWER]: [done({ answer: "Hello." })],
  });
  const second = await CodingHarness.create(t, simple, { skills });
  assert.equal((await second.send("Hi?", { mode: "answer-only" })).message, "Hello.");
  assert.equal(simple.sessions("SKILL-trace"), 0);
});
