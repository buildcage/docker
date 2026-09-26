// Loads a page in chrome-headless-shell and reports whether the handshake got
// past certificate verification. Usage: node chromium-check.js <url> [untrusted]
// With "untrusted", the run passes only when Chromium refuses the certificate,
// which is how the test proves the check can fail at all.
const puppeteer = require("puppeteer-core");

const [url, expect = "trusted"] = process.argv.slice(2);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_HEADLESS_SHELL,
    // A RUN step has no user namespace to sandbox with, and a small /dev/shm.
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
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
  console.log(`HOME=${process.env.HOME}: ${outcome}`);
  if (expect === "untrusted") {
    if (!outcome.includes("ERR_CERT_AUTHORITY_INVALID")) {
      console.log("FAILED: expected Chromium to refuse the proxy's certificate");
      process.exit(1);
    }
  } else if (!trusted) {
    console.log("FAILED: Chromium did not trust the proxy CA");
    process.exit(1);
  }
})().catch((e) => {
  console.log(`FAILED: ${e.message}`);
  process.exit(1);
});
