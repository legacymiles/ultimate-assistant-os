// ---------------------------------------------------------------------------
// `next build`, retried only when Google Fonts hands back a URL Next cannot read.
//
// The problem, measured rather than guessed: fonts.googleapis.com usually
// answers with static file URLs ending in `.woff2`, but roughly one request in
// a hundred comes back with its dynamic form instead:
//
//   https://fonts.gstatic.com/l/font?kit=...&skey=...&v=v22
//
// `next/font/google` ends its loader with
//
//   /\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl)[1]
//
// which is `null[1]` for that shape, so the build dies with
// "TypeError: Cannot read properties of null (reading '1')" naming whichever
// font lost the coin toss. This build asks for about twenty font files, so a
// single build failed roughly half the time — on any host, and long before
// anything here moved to Cloudflare.
//
// Nothing in this repo can stop Google choosing that form, and the choice is
// per request, so simply asking again almost always works. This retries ONLY
// on that signature: any other failure exits immediately with its own code, so
// a real compile error still fails fast and loudly.
//
// The permanent fix is to stop fetching fonts at build time at all — download
// them once and load them with `next/font/local`. Until then, this keeps
// deploys from failing for a reason nobody can act on.
// See docs/hosting-cloudflare.md › If a deploy fails on fonts.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";

const ATTEMPTS = 3;

/** The exact failure above, and nothing else. */
function isGoogleFontsFlake(output) {
  return (
    /next\/font/.test(output) &&
    /Cannot read properties of null \(reading '1'\)/.test(output)
  );
}

function runBuild() {
  return new Promise((resolve) => {
    // Inherit stdio so the build streams as usual, and tee it so the text can
    // be matched afterwards. Without the tee the output would have to be
    // swallowed and replayed, which hides progress on a slow build.
    let seen = "";
    const child = spawn("npx", ["next", "build"], {
      shell: true,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    const pass = (stream, to) => {
      stream.on("data", (chunk) => {
        seen += chunk;
        to.write(chunk);
      });
    };
    pass(child.stdout, process.stdout);
    pass(child.stderr, process.stderr);
    child.on("close", (code) => resolve({ code: code ?? 1, output: seen }));
  });
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const { code, output } = await runBuild();
  if (code === 0) process.exit(0);

  if (!isGoogleFontsFlake(output)) process.exit(code);

  if (attempt === ATTEMPTS) {
    console.error(
      `\nGoogle Fonts returned an unreadable font URL on all ${ATTEMPTS} attempts.\n` +
        "This is the dynamic /l/font?kit= form that next/font cannot parse — not a\n" +
        "problem with this code. Run the build again, or self-host the fonts.\n" +
        "See docs/hosting-cloudflare.md › If a deploy fails on fonts.\n",
    );
    process.exit(code);
  }

  console.error(
    `\nGoogle Fonts returned an unreadable font URL. Retrying the build ` +
      `(attempt ${attempt + 1} of ${ATTEMPTS})...\n`,
  );
}
