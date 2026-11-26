import { sectionGuide } from "../sections";

/** How to turn a document into findings (/analyze). */
export function extractionRules(): string {
  return `How to file facts from a document:
- Read the whole document with read_document, following nextOffset until it is null.
- File only atomic, concrete facts: one claim each, with a number, a name, a person's own words or a specific behaviour.
  Skip generic statements ("this market has great potential"), advice and AI filler.
- Every fact needs a quote copied exactly from the document text (12–400 characters). Never paraphrase or join quotes.
  If propose_finding answers with an error about the quote, copy a shorter exact passage, or skip that fact.
- Pick the single best section and fill fact with the section's shape. Sections:
${sectionGuide()}
- Before proposing, compare with the known findings from research_overview. Do not repeat one (also not a rejected one).
  When the document confirms or contradicts a known finding, propose the new fact and then link_findings it to the known id (supports / conflicts).
- Write statements in the language of the document.
- If the document's evidenceType is unknown, set it: real_user_quote for people's own words (forums, reviews, interviews),
  competitor_data for pricing pages, docs and articles about products, ai_brainstorm for text an AI wrote.`;
}

export const FINAL_ANSWER = `Finish with {"answer": "<markdown>"} in English: what you read, how many findings you proposed and linked,
what you skipped and why, and the stage percents from a last research_overview call. Remind the user that the findings wait for review in Research.`;
