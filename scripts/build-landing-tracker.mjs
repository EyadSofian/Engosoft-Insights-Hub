// Builds the standalone Odoo landing tracker from the shared attribution client,
// so Odoo pages run exactly the same UTM/first-touch rules as the collector.
// Runs automatically before `npm run build` (npm `prebuild` lifecycle).
import { build } from "esbuild";

await build({
  entryPoints: ["src/lib/landing-attribution.odoo.entry.ts"],
  outfile: "public/landing-attribution/odoo-tracker.js",
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2019"],
  legalComments: "none",
  logLevel: "info",
});
