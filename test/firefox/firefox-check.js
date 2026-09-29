// Loads a page in Playwright's Firefox and reports whether the handshake got
// past certificate verification. Usage: node firefox-check.js <url> [untrusted]
// With "untrusted", the run passes only when Firefox refuses the certificate,
// which is how the test proves the check can fail at all.
const { firefox } = require("playwright");

const [url, expect = "trusted"] = process.argv.slice(2);

(async () => {
  const browser = await firefox.launch();
  let outcome;
  try {
    const page = await browser.newPage();
    const response = await page.goto(url);
    outcome = `trusted (HTTP ${response.status()})`;
  } catch (e) {
    outcome = e.message.split("\n")[0];
  }
  await browser.close();

  const trusted = outcome.startsWith("trusted");
  console.log(
    `PLAYWRIGHT_FIREFOX_POLICIES_JSON=${process.env.PLAYWRIGHT_FIREFOX_POLICIES_JSON}: ${outcome}`,
  );
  if (expect === "untrusted") {
    if (!outcome.includes("SEC_ERROR_UNKNOWN_ISSUER")) {
      console.log("FAILED: expected Firefox to refuse the proxy's certificate");
      process.exit(1);
    }
  } else if (!trusted) {
    console.log("FAILED: Firefox did not trust the proxy CA");
    process.exit(1);
  }
})().catch((e) => {
  console.log(`FAILED: ${e.message}`);
  process.exit(1);
});
