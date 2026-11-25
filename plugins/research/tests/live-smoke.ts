// Manual smoke check against a running cognition (not part of `npm test`): research tools without a model.
import { CognitionClient, cognitionApiUrl } from "../src/CognitionClient";
import { resolveAppId } from "../src/AppResolver";
import { ResearchTools, RunTally } from "../src/ResearchTools";

const client = new CognitionClient(cognitionApiUrl({}, process.env), new AbortController().signal);
const { appId, appName } = await resolveAppId({}, process.argv[2] ?? "/roots/PersonalProjects/KushiBox/cognition/apps/test", client);
console.log("app:", appId, appName);
const tools = new ResearchTools(client, appId, () => {}, new RunTally(), ["research_overview", "list_documents", "read_document"]);
const overview = (await tools.call("research_overview", {})) as { stages: unknown[]; findings: unknown[] };
console.log("stages:", JSON.stringify(overview.stages));
console.log("findings:", overview.findings.length);
const docs = (await tools.call("list_documents", {})) as { documents: Array<{ id: string; title: string }> };
console.log("documents:", docs.documents.map((doc) => doc.title));
const part = (await tools.call("read_document", { id: docs.documents[0]!.id })) as { totalChars: number; nextOffset: number | null };
console.log("read:", part.totalChars, "chars, nextOffset", part.nextOffset);
