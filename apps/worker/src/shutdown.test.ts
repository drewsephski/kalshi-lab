import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { installShutdownHandlers } from "./shutdown.ts";

test("repeated shutdown signals are idempotent and handlers can be removed", () => {
  const target = new EventEmitter();
  const controller = new AbortController();
  const remove = installShutdownHandlers(controller, target);
  let aborts = 0;
  controller.signal.addEventListener("abort", () => aborts++);
  target.emit("SIGINT");
  target.emit("SIGINT");
  target.emit("SIGTERM");
  assert.equal(aborts, 1);
  assert.equal(target.listenerCount("SIGINT"), 1);
  remove();
  assert.equal(target.listenerCount("SIGINT"), 0);
  assert.equal(target.listenerCount("SIGTERM"), 0);
});

test("a real process survives repeated SIGTERM while finishing cleanup", async () => {
  const moduleUrl = new URL("./shutdown.ts", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { installShutdownHandlers } from ${JSON.stringify(moduleUrl)};
    const controller = new AbortController();
    const remove = installShutdownHandlers(controller);
    const hold = setInterval(() => {}, 1000);
    controller.signal.addEventListener('abort', () => {
      setTimeout(() => { console.log('cleaned'); clearInterval(hold); remove(); }, 100);
    }, { once: true });
    console.log('ready');
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  const exited = new Promise<{ code: number | null; signal: string | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  try {
    // Keep the child alive between readiness and external signals.
    await new Promise<void>((resolve) =>
      child.stdout.once("data", () => resolve()),
    );
    child.kill("SIGTERM");
    await setTimeout(10);
    child.kill("SIGTERM");
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.match(stdout, /cleaned/);
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
});
