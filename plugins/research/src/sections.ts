/**
 * Mirror of cognition's src/shared/research/researchStages.ts and researchFacts.ts (this package
 * cannot import cognition). cognition validates every write, so a stale copy fails loudly, not silently.
 */
export const SECTIONS = [
  { key: "problem.quotes", category: "users", hint: "A real person's own words about a pain they have.", fact: '{ "speaker"?: string }' },
  { key: "problem.cost", category: "users", hint: "Time or money the problem costs, with a number.", fact: '{ "amount": number > 0, "unit": "minutes"|"hours"|"eur"|"usd", "per": "task"|"day"|"week"|"month", "who"?: string }' },
  { key: "problem.frequency", category: "users", hint: "How often the problem happens.", fact: "{}" },
  { key: "problem.current_solution", category: "competitors", hint: "What people use today instead: spreadsheets, manual work, a competitor.", fact: "{}" },
  { key: "problem.market", category: "market", hint: "Concrete market facts with a number or a source.", fact: "{}" },
  { key: "monetization.buyer", category: "market", hint: "Who decides and pays: role, industry, company size.", fact: '{ "role": string, "industry": string, "companySize"?: string }' },
  { key: "monetization.competitor_pricing", category: "competitors", hint: "One competitor plan with its price.", fact: '{ "competitor": string, "plan": string, "price": number >= 0, "currency": string, "period": "month"|"year"|"once" }' },
  { key: "monetization.willingness_to_pay", category: "market", hint: "Evidence someone paid, or says they would pay, to solve this.", fact: "{}" },
  { key: "monetization.channel", category: "market", hint: "Where buyers gather or can be reached.", fact: "{}" },
  { key: "architecture.integration", category: "technical", hint: "An external system the product must connect to.", fact: '{ "name": string, "costKnown": boolean, "clarified": boolean, "monthlyCost"?: number, "currency"?: string }' },
  { key: "architecture.cost", category: "technical", hint: "Running or building costs: hosting, APIs, licences.", fact: "{}" },
  { key: "architecture.risk", category: "risks", hint: "Something that could make building or running it hard.", fact: "{}" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

export const EVIDENCE_TYPES = ["real_user_quote", "competitor_data", "ai_brainstorm"] as const;

export function sectionOf(key: unknown): (typeof SECTIONS)[number] | undefined {
  return SECTIONS.find((section) => section.key === key);
}

/** For instructions: one line per section with its hint and fact shape. */
export function sectionGuide(): string {
  return SECTIONS.map((section) => `- ${section.key}: ${section.hint} fact: ${section.fact}`).join("\n");
}
