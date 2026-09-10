/**
 * Turning a pasted `curl` command into a request.
 *
 * Copying a call out of the browser's network tab, a README or a colleague's
 * message is how most requests start life, so pasting one should build the
 * request rather than land as a URL nobody can send.
 */

import type { AuthModel } from "@/lib/sdk";
import type { KeyValueRow, RequestDraft } from "@/pages/playground/store/store";

export interface ParsedCurl {
  method: RequestDraft["method"];
  /** The full absolute URL, or a path when it sits under the connection's base. */
  path: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  body_type: RequestDraft["body_type"];
  body: string;
  auth: AuthModel;
  /** What was recognised, so the paste can say what it did. */
  summary: string;
}

/** Flags that take a value we care about. */
const VALUED = new Set([
  "-X",
  "--request",
  "-H",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-ascii",
  "--data-binary",
  "--data-urlencode",
  "--json",
  "-F",
  "--form",
  "--form-string",
  "-u",
  "--user",
  "-b",
  "--cookie",
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "--url",
  "-m",
  "--max-time",
  "--connect-timeout",
  "-o",
  "--output",
  "--retry",
  "--proto",
  "--cacert",
  "--cert",
  "--key",
  "--resolve",
  "-x",
  "--proxy",
]);

/** Flags we deliberately drop: they describe curl, not the request. */
const IGNORED_VALUED = new Set([
  "-m",
  "--max-time",
  "--connect-timeout",
  "-o",
  "--output",
  "--retry",
  "--proto",
  "--cacert",
  "--cert",
  "--key",
  "--resolve",
  "-x",
  "--proxy",
]);

const METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/** A paste is a curl command if it starts with one, ignoring leading noise. */
export function looksLikeCurl(text: string): boolean {
  return /^\s*(?:\$\s*)?curl[\s\\]/i.test(text);
}

/**
 * Split a command line the way a shell would.
 *
 * Handles single and double quotes, backslash continuations (bash) and the
 * caret continuations `cmd.exe` produces, because both turn up in pastes.
 */
export function tokenize(input: string): string[] {
  const text = input
    .replace(/\\\r?\n/g, " ")
    .replace(/\^\r?\n/g, " ")
    .replace(/`\r?\n/g, " ");

  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (quote === '"') {
      if (char === "\\" && index + 1 < text.length) {
        const next = text[index + 1];
        // only these are escapes inside double quotes; everything else is literal
        current += '"\\$`'.includes(next) ? next : char + next;
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      else current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }

    if (char === "\\" && index + 1 < text.length) {
      current += text[index + 1];
      index += 1;
      started = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (current || started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }

    current += char;
    started = true;
  }

  if (current || started) tokens.push(current);
  return tokens;
}

function splitHeader(raw: string): [string, string] | null {
  const at = raw.indexOf(":");
  if (at < 0) return null;
  return [raw.slice(0, at).trim(), raw.slice(at + 1).trim()];
}

function rowsOrEmpty(rows: KeyValueRow[]): KeyValueRow[] {
  return rows.length ? rows : [{ key: "", value: "", enabled: true }];
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** `a=1&b=2` — a urlencoded body, which reads better as form rows. */
function asFormPairs(text: string): [string, string][] | null {
  if (!text || text.includes("\n") || !text.includes("=")) return null;
  const pairs: [string, string][] = [];
  for (const part of text.split("&")) {
    const at = part.indexOf("=");
    if (at <= 0) return null;
    try {
      pairs.push([
        decodeURIComponent(part.slice(0, at)),
        decodeURIComponent(part.slice(at + 1)),
      ]);
    } catch {
      return null;
    }
  }
  return pairs.length ? pairs : null;
}

/**
 * Parse a curl command.
 *
 * `baseUrl` is the connection's base; a URL underneath it is shortened to a
 * path so the request stays portable across environments, and one that is not
 * is kept absolute — which the request runner already supports.
 */
export function parseCurl(input: string, baseUrl?: string): ParsedCurl | null {
  const tokens = tokenize(input);
  if (!tokens.length) return null;

  let cursor = 0;
  if (/^\$?$/.test(tokens[0])) cursor += 1;
  if ((tokens[cursor] ?? "").toLowerCase() !== "curl") return null;
  cursor += 1;

  let url = "";
  let method: string | null = null;
  const headers: KeyValueRow[] = [];
  const dataParts: string[] = [];
  const formRows: KeyValueRow[] = [];
  let auth: AuthModel = { type: "none" };
  let jsonFlag = false;
  let forceGet = false;
  const dropped: string[] = [];

  const valueFor = (inline?: string): string => {
    if (inline !== undefined) return inline;
    cursor += 1;
    return tokens[cursor] ?? "";
  };

  for (; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (!token) continue;

    if (!token.startsWith("-")) {
      if (!url) url = token;
      continue;
    }

    // --header=value and -HValue are both legal
    let flag = token;
    let inline: string | undefined;
    const equals = token.indexOf("=");
    if (token.startsWith("--") && equals > 0) {
      flag = token.slice(0, equals);
      inline = token.slice(equals + 1);
    } else if (!token.startsWith("--") && token.length > 2 && VALUED.has(token.slice(0, 2))) {
      flag = token.slice(0, 2);
      inline = token.slice(2);
    }

    if (IGNORED_VALUED.has(flag)) {
      valueFor(inline);
      dropped.push(flag);
      continue;
    }

    switch (flag) {
      case "-X":
      case "--request":
        method = valueFor(inline).toUpperCase();
        break;

      case "--url":
        url = valueFor(inline);
        break;

      case "-H":
      case "--header": {
        const parsed = splitHeader(valueFor(inline));
        if (parsed && parsed[0]) headers.push({ key: parsed[0], value: parsed[1], enabled: true });
        break;
      }

      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-ascii":
      case "--data-binary":
        dataParts.push(valueFor(inline));
        break;

      case "--data-urlencode": {
        const raw = valueFor(inline);
        const at = raw.indexOf("=");
        dataParts.push(
          at > 0
            ? `${raw.slice(0, at)}=${encodeURIComponent(raw.slice(at + 1))}`
            : encodeURIComponent(raw)
        );
        break;
      }

      case "--json":
        jsonFlag = true;
        dataParts.push(valueFor(inline));
        break;

      case "-F":
      case "--form":
      case "--form-string": {
        const raw = valueFor(inline);
        const at = raw.indexOf("=");
        if (at > 0) {
          formRows.push({ key: raw.slice(0, at), value: raw.slice(at + 1), enabled: true });
        }
        break;
      }

      case "-u":
      case "--user": {
        const raw = valueFor(inline);
        const at = raw.indexOf(":");
        auth = {
          type: "basic",
          username: at >= 0 ? raw.slice(0, at) : raw,
          password: at >= 0 ? raw.slice(at + 1) : "",
        };
        break;
      }

      case "-b":
      case "--cookie":
        headers.push({ key: "Cookie", value: valueFor(inline), enabled: true });
        break;

      case "-A":
      case "--user-agent":
        headers.push({ key: "User-Agent", value: valueFor(inline), enabled: true });
        break;

      case "-e":
      case "--referer":
        headers.push({ key: "Referer", value: valueFor(inline), enabled: true });
        break;

      case "-G":
      case "--get":
        forceGet = true;
        break;

      case "-I":
      case "--head":
        method = "HEAD";
        break;

      // curl's own switches, with no equivalent in a saved request
      case "-L":
      case "--location":
      case "-k":
      case "--insecure":
      case "-s":
      case "--silent":
      case "-S":
      case "--show-error":
      case "-i":
      case "--include":
      case "-v":
      case "--verbose":
      case "--compressed":
      case "-f":
      case "--fail":
      case "-g":
      case "--globoff":
      case "-N":
      case "--no-buffer":
        break;

      default:
        if (VALUED.has(flag)) valueFor(inline);
        dropped.push(flag);
        break;
    }
  }

  if (!url) return null;

  // an Authorization header is more useful as the auth block, where it is
  // masked and can be swapped without editing a header row
  const params: KeyValueRow[] = [];
  const keptHeaders: KeyValueRow[] = [];
  for (const header of headers) {
    if (header.key.toLowerCase() === "authorization" && auth.type === "none") {
      const [scheme, ...rest] = (header.value ?? "").split(/\s+/);
      const credential = rest.join(" ");
      if (/^bearer$/i.test(scheme) && credential) {
        auth = { type: "bearer", token: credential };
        continue;
      }
      auth = { type: "header", name: header.key, value: header.value ?? "" };
      continue;
    }
    keptHeaders.push(header);
  }

  let body = "";
  let bodyType: RequestDraft["body_type"] = "none";
  const data = dataParts.join("&");

  if (formRows.length) {
    bodyType = "form";
    body = JSON.stringify(formRows);
  } else if (data) {
    const declared = keptHeaders
      .find((header) => header.key.toLowerCase() === "content-type")
      ?.value?.toLowerCase();
    const formPairs =
      declared?.includes("x-www-form-urlencoded") || (!declared && !looksLikeJson(data))
        ? asFormPairs(data)
        : null;

    if (jsonFlag || looksLikeJson(data)) {
      bodyType = "json";
      body = data;
    } else if (formPairs) {
      bodyType = "form";
      body = JSON.stringify(
        formPairs.map(([key, value]) => ({ key, value, enabled: true }))
      );
    } else {
      bodyType = "text";
      body = data;
    }
  }

  // -G moves the data into the query string instead of the body
  if (forceGet && bodyType !== "none") {
    for (const [key, value] of asFormPairs(data) ?? []) {
      params.push({ key, value, enabled: true });
    }
    bodyType = "none";
    body = "";
  }

  if (!method) {
    if (forceGet) method = "GET";
    else if (bodyType !== "none") method = "POST";
    else method = "GET";
  }
  if (!METHODS.has(method)) method = "GET";

  const { path, query } = splitUrl(url, baseUrl);
  params.push(...query);

  if (jsonFlag) {
    const has = (name: string) =>
      keptHeaders.some((header) => header.key.toLowerCase() === name);
    if (!has("content-type"))
      keptHeaders.push({ key: "Content-Type", value: "application/json", enabled: true });
    if (!has("accept"))
      keptHeaders.push({ key: "Accept", value: "application/json", enabled: true });
  }

  return {
    method: method as RequestDraft["method"],
    path,
    params: rowsOrEmpty(params),
    headers: rowsOrEmpty(keptHeaders),
    body_type: bodyType,
    body,
    auth,
    summary: describe({
      method,
      headers: keptHeaders.length,
      params: params.length,
      bodyType,
      auth: auth.type ?? "none",
      dropped,
    }),
  };
}

/** Pull the query string out into rows, and shorten a URL under the base. */
function splitUrl(
  raw: string,
  baseUrl?: string
): { path: string; query: KeyValueRow[] } {
  const query: KeyValueRow[] = [];
  let text = raw.trim();

  const hash = text.indexOf("#");
  const fragment = hash >= 0 ? text.slice(hash) : "";
  if (hash >= 0) text = text.slice(0, hash);

  const mark = text.indexOf("?");
  if (mark >= 0) {
    const search = text.slice(mark + 1);
    text = text.slice(0, mark);
    for (const part of search.split("&")) {
      if (!part) continue;
      const at = part.indexOf("=");
      const key = at >= 0 ? part.slice(0, at) : part;
      const value = at >= 0 ? part.slice(at + 1) : "";
      // a {{variable}} survives decoding as itself, so decode is safe here
      query.push({ key: safeDecode(key), value: safeDecode(value), enabled: true });
    }
  }

  const under = relativeTo(text, baseUrl);
  return { path: (under ?? text) + fragment, query };
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

/** A URL sitting under the connection's base becomes a path under it. */
function relativeTo(url: string, baseUrl?: string): string | null {
  if (!baseUrl || !/^https?:\/\//i.test(url)) return null;
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) return null;
  if (url.toLowerCase().startsWith(base.toLowerCase() + "/")) return url.slice(base.length);
  if (url.toLowerCase() === base.toLowerCase()) return "/";
  return null;
}

function describe(parts: {
  method: string;
  headers: number;
  params: number;
  bodyType: string;
  auth: string;
  dropped: string[];
}): string {
  const pieces = [parts.method];
  if (parts.params) pieces.push(`${parts.params} param${parts.params === 1 ? "" : "s"}`);
  if (parts.headers)
    pieces.push(`${parts.headers} header${parts.headers === 1 ? "" : "s"}`);
  if (parts.bodyType !== "none") pieces.push(`${parts.bodyType} body`);
  if (parts.auth !== "none") pieces.push(`${parts.auth} auth`);

  let summary = `Parsed curl — ${pieces.join(", ")}`;
  if (parts.dropped.length) {
    const unique = [...new Set(parts.dropped)];
    summary += `. Ignored ${unique.join(", ")}`;
  }
  return summary;
}
