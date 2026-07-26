import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/main.js"],
  bundle: true,
  outfile: "app.js",
  format: "iife",
  target: "es2019",
  sourcemap: true,
  logLevel: "info",
});
