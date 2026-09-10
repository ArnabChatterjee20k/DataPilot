import { test as base, expect } from "@playwright/test";

/**
 * The base test, extended to fail on an uncaught page error.
 *
 * A React crash renders a blank page, which otherwise shows up as a confusing
 * "element not found" somewhere further down the test rather than as the
 * exception that actually happened.
 */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await use(errors);

    const fatal = errors.filter(
      (message) =>
        // a failed fetch is the subject of several tests, not a crash
        !/Failed to load resource|net::ERR_|status of 4\d\d|status of 5\d\d/.test(
          message
        )
    );
    expect(fatal, `the page reported errors:\n${fatal.join("\n")}`).toEqual([]);
  },
});

export { expect };
