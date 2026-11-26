/**
 * Domains whose text counts as an official source: a law, a regulator or a government page. The code
 * decides this, not the model: `save_source` marks a document `official_source` only when every result
 * comes from one of these hosts. Extend the list in a reviewed change, not at run time.
 */
const OFFICIAL_SUFFIXES = [
  "europa.eu", // EUR-Lex, EDPB, the Commission
  "gov", // US federal
  "gov.uk",
  "gov.bg",
  "government.bg",
  "parliament.bg", // State Gazette and the National Assembly
  "cpdp.bg", // Bulgarian data protection commission
  "nra.bg",
  "nap.bg",
  "bnb.bg",
  "cpc.bg",
  "fsc.bg",
] as const;

/** True when the URL is https and its host is, or is under, an official domain. */
export function isOfficialUrl(value: string | undefined): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return OFFICIAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
