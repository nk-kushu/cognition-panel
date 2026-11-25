// Manual smoke check: an invented quote is refused by cognition and reaches the model as { error }.
import { CognitionClient, cognitionApiUrl } from "../src/CognitionClient";
import { ResearchTools, RunTally } from "../src/ResearchTools";
import { ToolBox } from "../src/ToolBox";

const client = new CognitionClient(cognitionApiUrl({}, process.env), new AbortController().signal);
const appId = process.argv[2]!;
const documentId = process.argv[3]!;
const box = new ToolBox([new ResearchTools(client, appId, () => {}, new RunTally(), ["propose_finding"])]);
const outcome = await box.dispatch({
  operationId: "smoke",
  toolId: "propose_finding",
  arguments: { documentId, section: "problem.frequency", statement: "Invented", quote: "this sentence is not in the document at all" },
} as never);
console.log(JSON.stringify((outcome as { observation: { value: unknown } }).observation.value));
