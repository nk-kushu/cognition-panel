import type { Http } from "../Http";
import type { Env, ISourceProvider } from "../types";
import { AppStoreReviews, DataForSeo, DataForSeoKeywordVolume, GoogleAdsTransparency, GoogleTrends } from "./DataForSeo";
import { HackerNews, MetaAdLibrary, Reddit } from "./Social";
import { Brave, Firecrawl, StaticFetch, Tavily } from "./Web";

/**
 * Every provider, in the order a "first available" category tries them. Two per category:
 * keywords (volume + trends), web (Tavily, Brave), ads (Meta, Google), community (Reddit, HN),
 * reviews (app stores + G2), pages (Firecrawl, static fetch).
 */
export function createProviders(env: Env, http: Http, signal: AbortSignal, wait?: (ms: number) => Promise<void>): ISourceProvider[] {
  const dataForSeo = new DataForSeo(env, http, signal, wait);
  return [
    new DataForSeoKeywordVolume(dataForSeo),
    new GoogleTrends(dataForSeo),
    new Tavily(env, http),
    new Brave(env, http),
    new MetaAdLibrary(env, http),
    new GoogleAdsTransparency(dataForSeo),
    new Reddit(env, http),
    new HackerNews(http),
    new AppStoreReviews(dataForSeo, "google-play"),
    new AppStoreReviews(dataForSeo, "app-store"),
    new Firecrawl(env, http, "g2"),
    new Firecrawl(env, http),
    new StaticFetch(http),
  ];
}
