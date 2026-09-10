import { expect, test } from "@playwright/test";

import { looksLikeCurl, parseCurl, tokenize } from "../src/lib/curl";

/** Parsing is pure, so it is checked directly rather than through the UI. */
test.describe("tokenizing", () => {
  test("keeps quoted arguments whole", () => {
    expect(tokenize(`curl -H 'X-A: one two' https://x`)).toEqual([
      "curl",
      "-H",
      "X-A: one two",
      "https://x",
    ]);
  });

  test("joins backslash continuations", () => {
    expect(tokenize("curl \\\n  -X POST \\\n  https://x")).toEqual([
      "curl",
      "-X",
      "POST",
      "https://x",
    ]);
  });

  test("joins the caret continuations cmd.exe produces", () => {
    expect(tokenize("curl ^\n  -X POST ^\n  https://x")).toEqual([
      "curl",
      "-X",
      "POST",
      "https://x",
    ]);
  });

  test("keeps an empty quoted argument", () => {
    expect(tokenize(`curl -d '' https://x`)).toEqual(["curl", "-d", "", "https://x"]);
  });

  test("does not treat a backslash inside single quotes as an escape", () => {
    expect(tokenize(`curl -d '{"a":"b\\c"}'`)).toEqual(["curl", "-d", '{"a":"b\\c"}']);
  });
});

test.describe("recognising a paste", () => {
  test("accepts a curl command, with or without a prompt", () => {
    expect(looksLikeCurl("curl https://x")).toBe(true);
    expect(looksLikeCurl("  $ curl https://x")).toBe(true);
    expect(looksLikeCurl("curl \\\n https://x")).toBe(true);
  });

  test("leaves a plain URL alone", () => {
    expect(looksLikeCurl("https://x/curl")).toBe(false);
    expect(looksLikeCurl("curling")).toBe(false);
  });
});

test.describe("parsing", () => {
  test("a bare GET", () => {
    const parsed = parseCurl("curl https://api.example.com/users")!;
    expect(parsed.method).toBe("GET");
    expect(parsed.path).toBe("https://api.example.com/users");
    expect(parsed.body_type).toBe("none");
  });

  test("the query string becomes rows, so it can be toggled", () => {
    const parsed = parseCurl("curl 'https://x/users?page=2&q=ada%20l'")!;
    expect(parsed.path).toBe("https://x/users");
    expect(parsed.params).toEqual([
      { key: "page", value: "2", enabled: true },
      { key: "q", value: "ada l", enabled: true },
    ]);
  });

  test("a JSON body implies POST", () => {
    const parsed = parseCurl(
      `curl https://x/users -H 'Content-Type: application/json' -d '{"name":"Ada"}'`
    )!;
    expect(parsed.method).toBe("POST");
    expect(parsed.body_type).toBe("json");
    expect(parsed.body).toBe('{"name":"Ada"}');
  });

  test("an explicit method wins over the body's implication", () => {
    const parsed = parseCurl(`curl -X PATCH https://x/u/1 -d '{"a":1}'`)!;
    expect(parsed.method).toBe("PATCH");
  });

  test("a urlencoded body becomes form rows", () => {
    const parsed = parseCurl("curl https://x/login -d 'user=ada&pass=x y'")!;
    expect(parsed.body_type).toBe("form");
    expect(JSON.parse(parsed.body)).toEqual([
      { key: "user", value: "ada", enabled: true },
      { key: "pass", value: "x y", enabled: true },
    ]);
  });

  test("repeated -d flags are joined the way curl joins them", () => {
    const parsed = parseCurl("curl https://x -d a=1 -d b=2")!;
    expect(JSON.parse(parsed.body)).toHaveLength(2);
  });

  test("a bearer header becomes auth, where it is masked", () => {
    const parsed = parseCurl(`curl https://x -H 'Authorization: Bearer abc.def'`)!;
    expect(parsed.auth).toEqual({ type: "bearer", token: "abc.def" });
    expect(parsed.headers.some((row) => row.key === "Authorization")).toBe(false);
  });

  test("a non-bearer Authorization keeps its scheme", () => {
    const parsed = parseCurl(`curl https://x -H 'Authorization: Token abc'`)!;
    expect(parsed.auth.type).toBe("header");
    expect(parsed.auth.value).toBe("Token abc");
  });

  test("-u becomes basic auth", () => {
    const parsed = parseCurl("curl -u ada:secret https://x")!;
    expect(parsed.auth).toEqual({ type: "basic", username: "ada", password: "secret" });
  });

  test("-F builds a form", () => {
    const parsed = parseCurl("curl -F name=ada -F role=admin https://x")!;
    expect(parsed.body_type).toBe("form");
    expect(parsed.method).toBe("POST");
  });

  test("--json sets the body and both headers", () => {
    const parsed = parseCurl(`curl --json '{"a":1}' https://x`)!;
    expect(parsed.body_type).toBe("json");
    const names = parsed.headers.map((row) => row.key.toLowerCase());
    expect(names).toContain("content-type");
    expect(names).toContain("accept");
  });

  test("-G moves the data into the query string", () => {
    const parsed = parseCurl("curl -G https://x/search -d q=ada -d page=2")!;
    expect(parsed.method).toBe("GET");
    expect(parsed.body_type).toBe("none");
    expect(parsed.params.map((row) => row.key)).toEqual(["q", "page"]);
  });

  test("-I asks for headers only", () => {
    expect(parseCurl("curl -I https://x")!.method).toBe("HEAD");
  });

  test("curl's own switches are ignored without being mistaken for a URL", () => {
    const parsed = parseCurl("curl -sSL --compressed https://x/y")!;
    expect(parsed.path).toBe("https://x/y");
    expect(parsed.method).toBe("GET");
  });

  test("flags that describe curl rather than the request are reported", () => {
    const parsed = parseCurl("curl --max-time 5 https://x")!;
    expect(parsed.path).toBe("https://x");
    expect(parsed.summary).toContain("--max-time");
  });

  test("a URL under the connection's base becomes a path", () => {
    const parsed = parseCurl("curl https://api.example.com/v1/users", "https://api.example.com/v1")!;
    expect(parsed.path).toBe("/users");
  });

  test("a URL outside the base stays absolute", () => {
    const parsed = parseCurl("curl https://other.example.com/users", "https://api.example.com")!;
    expect(parsed.path).toBe("https://other.example.com/users");
  });

  test("the browser's own copy-as-cURL shape parses", () => {
    const parsed = parseCurl(
      [
        `curl 'https://api.example.com/v1/orders?status=open' \\`,
        `  -H 'accept: application/json' \\`,
        `  -H 'authorization: Bearer tok_123' \\`,
        `  -H 'content-type: application/json' \\`,
        `  --data-raw '{"note":"it'"'"'s fine"}' \\`,
        `  --compressed`,
      ].join("\n")
    )!;

    expect(parsed.method).toBe("POST");
    expect(parsed.path).toBe("https://api.example.com/v1/orders");
    expect(parsed.params).toEqual([{ key: "status", value: "open", enabled: true }]);
    expect(parsed.auth).toEqual({ type: "bearer", token: "tok_123" });
    expect(parsed.body_type).toBe("json");
    expect(JSON.parse(parsed.body).note).toBe("it's fine");
  });

  test("something that is not curl parses to nothing", () => {
    expect(parseCurl("wget https://x")).toBeNull();
    expect(parseCurl("curl -X POST")).toBeNull();
  });
});
