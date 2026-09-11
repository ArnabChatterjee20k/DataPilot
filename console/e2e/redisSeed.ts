import net from "node:net";

/**
 * Seeding the Redis the tests run against.
 *
 * The data used to be whatever happened to be in the container, so a test
 * could fail because someone had run FLUSHALL an hour earlier. Redis speaks a
 * protocol simple enough to write out here, which is cheaper than adding a
 * client library for fifteen keys.
 */

function encode(args: (string | number)[]): string {
  const parts = args.map((arg) => {
    const text = String(arg);
    return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
  });
  return `*${args.length}\r\n${parts.join("")}`;
}

/** The keys every Redis test reads, and why each one is here. */
const COMMANDS: (string | number)[][] = [
  ["FLUSHDB"],

  ["SET", "greeting", "hello"],
  ["SET", "counter", "42"],

  // a hash small enough that the field filter should stay out of the way, with
  // one field holding JSON, which is how applications really use a hash
  [
    "HSET",
    "user:7",
    "name",
    "ada",
    "email",
    "ada@example.com",
    "plan",
    "pro",
    "profile",
    '{"theme":"dark","density":"compact"}',
  ],

  // ascending by score, so the first row is the lowest
  ["ZADD", "leaderboard", 99, "bob", 150, "dave", 240, "carol"],

  ["RPUSH", "queue:jobs", "first", "second", "third"],
  ["SADD", "tags", "redis", "database", "console", "tooling"],
  ["XADD", "events", "*", "kind", "signup", "user", "7"],

  // a shared prefix, so the browser has something to group
  [
    "SETEX",
    "session:abc",
    600,
    '{"user":{"id":7,"name":"ada","roles":["admin","owner"]},"ip":"10.0.0.4","expires":1789000000,"verified":true,"device":null}',
  ],
  ["SET", "session:def", '{"user":{"id":9,"name":"sam","roles":["viewer"]},"ip":"10.0.0.9"}'],
  ["SET", "config:flags", '{"features":{"flows":true},"limits":{"rows":500}}'],
  ["RPUSH", "tasks:pending", '{"job":"export"}', "retry", "retry"],
  ["RPUSH", "tasks:done", "done-1", "done-2"],
  ["XADD", "stream:orders", "*", "type", "created", "total", "99"],
];

// big enough to need the filter the small hash does not get
for (let day = 1; day <= 24; day += 1) {
  COMMANDS.push(["HSET", "metrics:daily", `day-${day}`, String(day * 7)]);
}

export async function seedRedis(url: string): Promise<void> {
  const parsed = new URL(url);
  const database = parsed.pathname.replace("/", "") || "0";

  const commands = [["SELECT", database], ...COMMANDS, ["PING"]];

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
    });

    let seen = "";
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(10_000, () => fail(new Error("Redis did not answer in time")));
    socket.on("error", fail);

    socket.on("connect", () => {
      socket.write(commands.map(encode).join(""));
    });

    socket.on("data", (chunk) => {
      seen += chunk.toString();
      // every reply arrives in order, so PONG means the seed landed
      if (seen.includes("+PONG")) {
        socket.end();
        const failure = seen.split("\r\n").find((line) => line.startsWith("-"));
        if (failure) reject(new Error(`Redis refused a seed command: ${failure}`));
        else resolve();
      }
    });
  });
}
