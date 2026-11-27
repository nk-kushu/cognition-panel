import type { SectionKey } from "./sections";

/**
 * Where a person can look by hand, and what to look for there. The research agent's `/sources` command turns
 * this into a plan for one idea. The text only says what to search and what signals to note: it never claims
 * what a site contains, because it cannot see the site.
 */
export type SourceGuide = Readonly<{
  id: string;
  name: string;
  /** Research sections the evidence from this site files into. */
  sections: readonly SectionKey[];
  /** The evidence type to choose when sending the page to Knowledge. */
  evidence: "real_user_quote" | "official_source" | "competitor_data";
  /** What to type or open. `<niche>`, `<competitor>`, `<task>` and `<country>` are filled from the idea. */
  searchFor: readonly string[];
  /** The signals worth noting once the page is open. */
  lookFor: readonly string[];
  /** How to get the page into Knowledge. */
  capture: string;
}>;

const CAPTURE = "Cognition Capture reads it (or copy the text into Work → Knowledge)";

export const SOURCE_GUIDE: readonly SourceGuide[] = [
  {
    id: "reddit",
    name: "Reddit",
    sections: ["problem.quotes", "problem.cost", "problem.frequency", "problem.current_solution", "monetization.willingness_to_pay", "monetization.channel"],
    evidence: "real_user_quote",
    searchFor: [
      "<niche> alternatives",
      "frustrated with <competitor>  /  switched from <competitor>",
      "how do you <task>  /  best tool for <task>",
      "the communities (subreddits) where the buyer asks for help: note their names, they are the channel",
    ],
    lookFor: [
      "complaints in the person's own words, ideally with a number (hours lost, money lost, how often)",
      "what they use today instead: spreadsheets, manual work, a named competitor",
      "'I would pay for…' or a price they mention",
      "threads with many replies: repeated pain counts more than one rant",
    ],
    capture: `Open a thread, expand 'more replies', then ${CAPTURE}. One thread per document.`,
  },
  {
    id: "hackernews",
    name: "Hacker News",
    sections: ["problem.quotes", "problem.current_solution", "problem.market", "monetization.competitor_pricing"],
    evidence: "real_user_quote",
    searchFor: ["Ask HN: <task>", "Show HN: <niche> tool", "<competitor> (find the discussion threads)"],
    lookFor: ["how technical buyers solve it today", "complaints about a competitor's price or lock-in", "what founders say they tried and dropped"],
    capture: `Search at hn.algolia.com, open the item page (news.ycombinator.com/item?id=…), then ${CAPTURE}. The reader works on item pages, not on the search page.`,
  },
  {
    id: "g2",
    name: "G2",
    sections: ["problem.quotes", "problem.current_solution", "monetization.buyer", "monetization.competitor_pricing"],
    evidence: "real_user_quote",
    searchFor: ["the <niche> category page: it lists the competitors, note the top five", "<competitor> reviews, low ratings first if the page lets you filter"],
    lookFor: [
      "what reviewers dislike, repeated across reviews (the gap you can fill)",
      "why people switched away",
      "price complaints and missing features",
      "the reviewer's role and company size (this is your buyer)",
    ],
    capture: `One competitor's reviews per document; scroll to load more reviews, then ${CAPTURE}. G2 may ask you to sign in.`,
  },
  {
    id: "google-play",
    name: "Google Play",
    sections: ["problem.quotes", "problem.current_solution"],
    evidence: "real_user_quote",
    searchFor: ["a competitor's mobile app page (only if the product has a mobile side)", "open 'See all reviews' and filter to the lowest ratings if the page offers it"],
    lookFor: ["bugs and missing features that repeat", "subscription or price complaints", "what users wish the app did"],
    capture: `Open the reviews so they load, then ${CAPTURE}.`,
  },
  {
    id: "app-store",
    name: "App Store",
    sections: ["problem.quotes", "problem.current_solution"],
    evidence: "real_user_quote",
    searchFor: ["a competitor's page on apps.apple.com (only if the product has a mobile side)", "'See All' for the reviews"],
    lookFor: ["repeated complaints and feature requests", "price and subscription complaints"],
    capture: `Load the reviews, then ${CAPTURE}.`,
  },
  {
    id: "meta-ads",
    name: "Meta Ad Library",
    sections: ["monetization.competitor_pricing", "monetization.channel", "monetization.buyer"],
    evidence: "competitor_data",
    searchFor: ["<competitor> name", "<niche> keywords", "set the country to <country> and the status to active, if the page offers it"],
    lookFor: [
      "the offer and any price in the ad text",
      "the pain the ad speaks to: it is what the competitor believes the buyer cares about",
      "how long an ad has been running (long-running usually means it works)",
    ],
    capture: `Scroll to load the ads, then ${CAPTURE}. The text of the ads is captured; images are not. Meta shows commercial ads only in some regions, so a search may return little.`,
  },
  {
    id: "search",
    name: "Google, Brave or DuckDuckGo",
    sections: ["monetization.competitor_pricing", "problem.market", "problem.current_solution", "architecture.cost", "architecture.integration"],
    evidence: "competitor_data",
    searchFor: [
      "<niche> software  /  <niche> alternatives (to find the competitors if you do not know them yet)",
      "<competitor> pricing",
      "<niche> market size report  /  <niche> statistics <country>",
      "<niche> software price comparison  /  best <niche> tools",
    ],
    lookFor: [
      "the competitors that keep appearing: note the names, you will need them for the other sites",
      "pricing pages and comparison articles with real prices",
      "market reports with a number and a source",
    ],
    capture: `Send the results page for the list of competitors, but open the pages that matter (a pricing page, a report) and send each one: ${CAPTURE}.`,
  },
  {
    id: "keyword-planner",
    name: "Google Keyword Planner",
    sections: ["problem.market", "monetization.willingness_to_pay"],
    evidence: "competitor_data",
    searchFor: ["5–10 keywords: the problem in the buyer's words, the product category, the competitors' names", "the country and language of your market: <country>"],
    lookFor: [
      "average monthly searches: is anyone looking?",
      "cost per click and advertiser competition: do businesses pay to reach this buyer?",
      "problem words versus product words: people may search the pain, not the solution",
    ],
    capture: `Send the results table, or use 'Download plan' and paste the CSV in the Paste tab of Cognition Capture. Keyword Planner needs a Google Ads account.`,
  },
  {
    id: "google-trends",
    name: "Google Trends",
    sections: ["problem.market"],
    evidence: "competitor_data",
    searchFor: ["2–5 terms to compare: the problem, the category, the leading competitor", "the region <country>, the last 12 months and then 5 years"],
    lookFor: ["rising, falling or flat interest", "seasonality: when the buyer searches", "the 'rising' related queries: new words buyers use"],
    capture: `The chart is drawn on a canvas, so it has no text to read: download the CSV and paste it in the Paste tab of Cognition Capture, with the terms and region in the title.`,
  },
  {
    id: "ads-transparency",
    name: "Google Ads Transparency Center",
    sections: ["monetization.channel", "monetization.competitor_pricing"],
    evidence: "competitor_data",
    searchFor: ["the competitor's domain", "the region <country>"],
    lookFor: ["how many ads and in which formats", "how long they have been shown", "which regions: where the competitor spends"],
    capture: `${CAPTURE}. Only the text on the page is captured; the ads are images, so note the messages you see yourself in the title or in a pasted note.`,
  },
  {
    id: "pricing-pages",
    name: "Competitor pricing, docs and terms pages",
    sections: ["monetization.competitor_pricing", "architecture.integration", "architecture.cost", "monetization.buyer"],
    evidence: "competitor_data",
    searchFor: ["<competitor> /pricing", "<competitor> integrations or API docs", "<competitor> terms of service (limits, refunds, data ownership)"],
    lookFor: [
      "plan names, prices, billing period (month or year), the free plan and its limits",
      "what 'contact us' hides: enterprise tiers",
      "the integrations list and API limits",
      "who each plan is for: it reveals the buyer",
    ],
    capture: `One page per document so each price quotes cleanly: ${CAPTURE}.`,
  },
  {
    id: "official-sources",
    name: "Official legal sources",
    sections: ["legal.data_protection", "legal.sector_rules", "legal.terms_ip", "legal.tax_entity", "legal.licences_cost"],
    evidence: "official_source",
    searchFor: [
      "the law by name and article, for <country> and the EU (for example the data protection regulation)",
      "the regulator for <country> and the sector (data protection authority, tax authority, financial or health regulator)",
      "<niche> licence requirements <country>",
    ],
    lookFor: [
      "who the rule applies to and from what size or threshold",
      "the duties: consent, registration, records, reporting",
      "fees, deadlines and penalties",
      "explicit exceptions: a rule that does not apply is also a finding",
    ],
    capture: `Open the official page (an EU, government or regulator domain) and ${CAPTURE}; it is pre-selected as an official source. Not legal advice: a lawyer still checks it.`,
  },
];

/** The guide as compact lines for the agent's instructions. */
export function sourceGuideText(): string {
  return SOURCE_GUIDE.map((source) =>
    [
      `- ${source.id} (${source.name}) → files into: ${source.sections.join(", ")}; evidence type: ${source.evidence}`,
      `    search for: ${source.searchFor.join(" | ")}`,
      `    look for: ${source.lookFor.join(" | ")}`,
      `    capture: ${source.capture}`,
    ].join("\n"),
  ).join("\n");
}
