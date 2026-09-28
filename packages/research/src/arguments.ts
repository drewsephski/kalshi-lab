import { parseArgs } from "node:util";
import { validateSelection, type Selection } from "./queries.ts";
export function parseSelection(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      from: { type: "string" },
      to: { type: "string" },
      source: { type: "string", default: "kalshi_production_public" },
      runs: { type: "string" },
      tickers: { type: "string" },
      json: { type: "string" },
      "max-rows": { type: "string", default: "250000" },
      "cadence-ms": { type: "string", default: "5000" },
      "gap-ms": { type: "string", default: "7500" },
      "forward-tolerance-ms": { type: "string", default: "2500" },
      formal: { type: "boolean", default: false },
    },
  });
  if (values.source !== "kalshi_production_public")
    throw new Error("Only production-public research is supported.");
  if (!values.from?.endsWith("Z") || !values.to?.endsWith("Z"))
    throw new Error(
      "Usage: research:microstructure --from UTC_ISO_Z --to UTC_ISO_Z [--runs UUID,...] [--tickers TICKER,...] [--json PATH] [--formal].",
    );
  const selection: Selection = {
    source: values.source,
    from: new Date(values.from),
    to: new Date(values.to),
    runIds: [...new Set(values.runs?.split(",").filter(Boolean) ?? [])].sort(),
    tickers: [
      ...new Set(values.tickers?.split(",").filter(Boolean) ?? []),
    ].sort(),
    maxRows: Number(values["max-rows"]),
  };
  validateSelection(selection);
  return {
    selection,
    options: {
      cadenceMs: Number(values["cadence-ms"]),
      gapToleranceMs: Number(values["gap-ms"]),
      forwardToleranceMs: Number(values["forward-tolerance-ms"]),
    },
    output: values.json,
    formal: values.formal,
  };
}
