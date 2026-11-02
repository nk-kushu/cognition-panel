export type DecisionChoice = Readonly<{ label: string; packages: readonly string[] }>;

/** Every assignment may finish its job, name a gap, or ask the human; never anything else. */
export type AssignmentEnvelope<TResult> =
  | Readonly<{ status: "done"; result: TResult; inform: readonly string[] }>
  | Readonly<{
      status: "needs-information";
      question: string;
      why: string;
      checked: readonly string[];
      route: "repository" | "design";
    }>
  | Readonly<{
      status: "needs-decision";
      question: string;
      findings: string;
      recommendation: string;
      choices: readonly DecisionChoice[];
    }>;

export const ENVELOPE_INSTRUCTIONS = `Your final value must be one of:
{"status":"done","result":<the expected result>,"inform":["findings worth showing the user"]}
{"status":"needs-information","question":"exact unanswered question","why":"why it blocks you","checked":["what you already looked at"],"route":"repository"}
  Use route "repository" for facts in the code and "design" when the approved design must change. "Investigate more" is not specific enough.
{"status":"needs-decision","question":"what the user must decide","findings":"the evidence","recommendation":"your recommendation","choices":[{"label":"option","packages":["package names this option adds"]}]}
  Use it for product choices, and always before adding a package. A recommendation is not approval.`;
