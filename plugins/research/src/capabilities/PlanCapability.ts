import { RESEARCH_TOOL_DESCRIPTIONS } from "../ResearchTools";
import { ToolBox } from "../ToolBox";
import type { CapabilityContext, ICapability } from "./Capability";

const TOOLS = ["research_overview", "read_idea", "business_plan_overview", "save_business_plan"] as const;

const BLOCK_KEYS = "problem, customer_segments, unique_value, solution, channels, revenue, costs, key_metrics, unfair_advantage";
const INPUT_KEYS = "price, startingCustomers, monthlyNewCustomers, monthlyChurn, variableCostPerCustomer, fixedMonthlyCosts, upfrontCost";

/**
 * Writes the app's business plan as a Lean Canvas from accepted findings only, plus the inputs of the
 * financial model. cognition checks every citation and computes every number; the model never states
 * a total, a forecast or a break-even month itself.
 */
export class PlanCapability implements ICapability {
  readonly id = "plan";
  readonly command = "/plan";
  readonly model = "main" as const;
  readonly whenToUse =
    "The user wants a business plan, a Lean Canvas, a revenue or cost model, or to know whether the idea can make money. " +
    'Examples: "/plan", "write a business plan", "make a Lean Canvas", "will this make money?", "update the plan with the new findings"';

  instructions(): string {
    return `You write the business plan of a product idea on the cognition platform: a Lean Canvas and the inputs of a financial model. You only use evidence that a person has accepted. Nothing you write is final: the person reads it in Work → Plan.

Plan:
1. Call read_idea, research_overview and business_plan_overview.
2. Fill the nine blocks (${BLOCK_KEYS}). Each block: {"statements":[{"text":"…","findingIds":["…"]}],"gap":"…"|null}, at most 6 statements of at most 300 characters, at most 5 findingIds each.
   - Cite only findings whose status is "accepted". business_plan_overview lists which research sections feed each block.
   - A statement from the idea alone has "findingIds":[]: it is shown as a hypothesis. Use that for solution, key_metrics and unfair_advantage when nothing better exists, and say so plainly in the text.
   - Never invent a fact. When a block has no accepted evidence, leave "statements":[] and write in "gap" what to research to fill it (a concrete search, community or competitor), in English.
   - Write your own wording in English; keep a finding's own words as they are.
3. Fill the financial inputs: {"currency":"EUR","inputs":{${INPUT_KEYS.split(", ").map((key) => `"${key}":{"value":n,"source":"<finding id>"|null,"note":"…"}`).join(",")}}}.
   - value is a number ≥ 0; monthlyChurn is a share between 0 and 1 (0.05 = 5%).
   - Take a number from a finding's fact when one exists (a competitor price for price, an integration's monthlyCost for fixedMonthlyCosts) and put that finding's id in source.
   - Every other number is an assumption: "source":null and a note that says why that value (e.g. "15% below Treatwell's price", "typical SMB SaaS churn, to be verified").
   - Convert yearly prices to monthly. Use one currency.
4. Call save_business_plan with the whole canvas and the financials. If it answers with an error about findings, remove those citations and save again.
5. Never compute revenue, profit or break-even yourself: read them from the answer of save_business_plan.

Finish with {"answer": "<markdown>"} in English:
- **Readiness:** how many blocks are confirmed, hypotheses, missing.
- **Strongest:** the best-backed statement.
- **Weakest:** the blocks that are missing or only hypotheses, with their gap.
- **Finances:** break-even month per scenario as cognition computed it, and which inputs are assumptions to check first.
Remind the user that the plan is in Work → Plan, where the inputs can be changed.

Tools (one call per action):
${TOOLS.map((id) => RESEARCH_TOOL_DESCRIPTIONS[id]).join("\n")}`;
  }

  tools(context: CapabilityContext) {
    return new ToolBox([context.research(TOOLS)]);
  }
}
