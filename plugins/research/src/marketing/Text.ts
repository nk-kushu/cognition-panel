const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#x2F": "/" };

/** Readable text from an HTML fragment or page: no scripts, styles or tags; paragraphs stay apart. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name: string) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? decodeNumeric(name) ?? match)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeNumeric(name: string): string | undefined {
  const code = name.startsWith("#x") ? Number.parseInt(name.slice(2), 16) : name.startsWith("#") ? Number.parseInt(name.slice(1), 10) : Number.NaN;
  return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : undefined;
}

export function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

export function slug(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "source";
}

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/**
 * Only public web pages may be read: the agent runs next to cognition and the Docker host, and page
 * text can try to steer it. Returns the reason a URL is refused, or null. It checks the name, not DNS.
 */
export function refusedUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "only http(s) pages can be read";
  if (url.username || url.password) return "URLs with credentials are not allowed";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "host.docker.internal")
    return "internal hosts are not allowed";
  if (PRIVATE_V4.some((pattern) => pattern.test(host))) return "private addresses are not allowed";
  if (host.includes(":") && (host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:")))
    return "private addresses are not allowed";
  if (!host.includes(".") && !host.includes(":")) return "internal hosts are not allowed";
  return null;
}
