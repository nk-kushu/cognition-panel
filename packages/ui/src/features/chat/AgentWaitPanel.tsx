import { Alert, Button, Checkbox, Collapse, Input, Radio, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { useAppDispatch } from "../../app/hooks";
import { errorMessage } from "../../shared/api/errorMessage";
import {
  kushexApi,
  useAgentWaitQuery,
  useAnswerAgentWaitMutation,
  useCancelAgentWaitMutation,
} from "../../shared/api/kushexApi";
import { Markdown } from "../../shared/components/Markdown";
import { messageSent, runStarted } from "../runs/runsSlice";
import { ChangeReview } from "./ChangeReview";

type Choice = Readonly<{ label: string }>;
type Change = Readonly<{ path: string; before: string | null; after: string | null }>;
type Declared = Readonly<{ file: string; signatures: readonly string[] }>;
type PlannedTest = Readonly<{ behavior: string; files: readonly string[] }>;

/** This decides presentation only; the server validates the saved wait. */
export const isWaitResult = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "presentation" in value &&
  value.presentation === "wait";

/** A question or skeleton review from a suspended run, restored from the server on reload. */
export function AgentWaitPanel({
  projectId,
  runId,
}: Readonly<{ projectId: string; runId: string }>) {
  const dispatch = useAppDispatch();
  const query = useAgentWaitQuery({ projectId, runId }, { refetchOnMountOrArgChange: true });
  const [submit, submitting] = useAnswerAgentWaitMutation();
  const [cancel, cancelling] = useCancelAgentWaitMutation();
  const [error, setError] = useState<string | null>(null);
  const wait = query.currentData;
  if (query.error)
    return <Alert className="kx:rounded-xl" type="error" title={errorMessage(query.error)} />;
  if (!wait) return null;

  const answer = async (
    request: Parameters<typeof submit>[0]["answer"],
    display: string,
  ): Promise<void> => {
    setError(null);
    try {
      const run = await submit({ projectId, runId, answer: request }).unwrap();
      dispatch(messageSent({ projectId, text: display, files: [], debug: false }));
      dispatch(runStarted(run));
      dispatch(kushexApi.util.invalidateTags(["ChatThreads"]));
      await query.refetch();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const stop = async () => {
    setError(null);
    try {
      await cancel({ projectId, runId }).unwrap();
      await query.refetch();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  if (wait.status !== "pending")
    return (
      <Typography.Text type="secondary">
        {wait.status === "cancelled" ? "Cancelled." : "Answered."}
      </Typography.Text>
    );
  const busy = submitting.isLoading || cancelling.isLoading;
  const failure = error && <Alert className="kx:rounded-xl" type="error" title={error} />;
  return wait.kind === "skeleton-review" ? (
    <SkeletonReview payload={wait.payload} busy={busy} onAnswer={answer} onCancel={stop}>
      {failure}
    </SkeletonReview>
  ) : (
    <Question payload={wait.payload} busy={busy} onAnswer={answer} onCancel={stop}>
      {failure}
    </Question>
  );
}

type Props = Readonly<{
  payload: Readonly<Record<string, unknown>>;
  busy: boolean;
  onAnswer: (
    request: { choice: string; text: string; digest?: string; remember?: string },
    display: string,
  ) => Promise<void>;
  onCancel: () => Promise<void>;
  children: React.ReactNode;
}>;

/** Shows the evidence, recommendation and choices, plus a field for a written answer. */
function Question({ payload, busy, onAnswer, onCancel, children }: Props) {
  const [choice, setChoice] = useState("");
  const [text, setText] = useState("");
  const [remember, setRemember] = useState(false);
  const question = String(payload.question ?? "");
  const choices = (payload.choices ?? []) as readonly Choice[];
  const statement = [question, choice || text].filter(Boolean).join(" ");
  return (
    <div className="kx:flex kx:flex-col kx:gap-3 kx:rounded-xl kx:border kx:border-border kx:p-3">
      <Typography.Text strong>{question}</Typography.Text>
      {typeof payload.findings === "string" && payload.findings && (
        <Markdown text={payload.findings} />
      )}
      {typeof payload.recommendation === "string" && payload.recommendation && (
        <Typography.Text type="secondary">Recommended: {payload.recommendation}</Typography.Text>
      )}
      <Radio.Group value={choice} onChange={(event) => setChoice(String(event.target.value))}>
        <Space orientation="vertical">
          {choices.map((item) => (
            <Radio key={item.label} value={item.label}>
              {item.label}
            </Radio>
          ))}
        </Space>
      </Radio.Group>
      <Input.TextArea
        aria-label="Your answer"
        placeholder="Add details or answer in your own words"
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Checkbox checked={remember} onChange={(event) => setRemember(event.target.checked)}>
        Remember for this project
      </Checkbox>
      {remember && (
        <Typography.Text type="secondary">
          Will remember: {statement || "your answer"}
        </Typography.Text>
      )}
      {children}
      <Space>
        <Button
          type="primary"
          loading={busy}
          disabled={!choice && !text.trim()}
          onClick={() =>
            void onAnswer(
              { choice, text, ...(remember ? { remember: statement.slice(0, 1000) } : {}) },
              [choice, text].filter(Boolean).join(": "),
            )
          }
        >
          {remember ? "Answer and remember" : "Use for this task"}
        </Button>
        <Button disabled={busy} onClick={() => void onCancel()}>
          Cancel run
        </Button>
      </Space>
    </div>
  );
}

/** Shows goal, plan, files, signatures, diff and tests; approval binds to the digest shown. */
function SkeletonReview({ payload, busy, onAnswer, onCancel, children }: Props) {
  const [text, setText] = useState("");
  const [comparing, setComparing] = useState(false);
  const digest = String(payload.digest ?? "");
  const declared = (payload.declared ?? []) as readonly Declared[];
  const tests = (payload.tests ?? []) as readonly PlannedTest[];
  const changes = (payload.changes ?? []) as readonly Change[];
  const unchecked = (payload.notLanguageChecked ?? []) as readonly string[];
  return (
    <div className="kx:flex kx:flex-col kx:gap-3 kx:rounded-xl kx:border kx:border-border kx:p-3">
      <Typography.Text strong>Review the skeleton</Typography.Text>
      <Typography.Text type="secondary">{String(payload.goal ?? "")}</Typography.Text>
      <Markdown text={String(payload.plan ?? "")} />
      {unchecked.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title="These files could not be checked for declarations only"
          description={unchecked.join(", ")}
        />
      )}
      <Collapse
        size="small"
        items={[
          {
            key: "signatures",
            label: `Signatures (${declared.length} files)`,
            children: declared.map((item) => (
              <div key={item.file} className="kx:mb-2">
                <Tag>{item.file}</Tag>
                {item.signatures.map((signature) => (
                  <pre key={signature} className="kx:m-0 kx:text-xs kx:whitespace-pre-wrap">
                    {signature}
                  </pre>
                ))}
              </div>
            )),
          },
          {
            key: "tests",
            label: `Tests (${tests.length})`,
            children: tests.map((test) => (
              <div key={test.behavior}>
                {test.behavior} <Tag>{test.files.join(", ")}</Tag>
              </div>
            )),
          },
        ]}
      />
      {changes.length > 0 && (
        <>
          <Button onClick={() => setComparing(true)}>Compare {changes.length} files</Button>
          <ChangeReview
            reviewOnly
            open={comparing}
            applying={false}
            applied={false}
            changes={changes}
            onClose={() => setComparing(false)}
            onApply={() => undefined}
          />
        </>
      )}
      <Input.TextArea
        aria-label="Requested changes"
        placeholder="What should change?"
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {children}
      <Space wrap>
        <Button
          type="primary"
          loading={busy}
          onClick={() =>
            void onAnswer({ choice: "approve", text: "", digest }, "Approved the skeleton.")
          }
        >
          Approve
        </Button>
        <Button
          disabled={busy || !text.trim()}
          onClick={() =>
            void onAnswer({ choice: "request-changes", text }, `Requested changes: ${text}`)
          }
        >
          Request changes
        </Button>
        <Button
          disabled={busy || !text.trim()}
          onClick={() => void onAnswer({ choice: "change-plan", text }, `Change the plan: ${text}`)}
        >
          Change the plan
        </Button>
        <Button disabled={busy} onClick={() => void onCancel()}>
          Cancel run
        </Button>
      </Space>
    </div>
  );
}
