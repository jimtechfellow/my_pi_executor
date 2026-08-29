#!/usr/bin/env node
// executor_harness — thin CLI client. One command per process; never terminates
// the persistent executor_harness_host or the pi --mode rpc parent.
import fs from "node:fs";
import net from "node:net";
import { socketPath } from "./lib/const.mjs";

function readStdin() {
  if (process.stdin.isTTY) return null;
  try { return fs.readFileSync(0, "utf8"); } catch { return null; }
}
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); args[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; }
    else args._.push(a);
  }
  return args;
}

function buildRequest(args) {
  const cmd = args._[0];
  switch (cmd) {
    case "doctor":
    case "ping":
      return { cmd, payload: { workspace: args.workspace } };
    case "shutdown":
      return { cmd, payload: {} };
    case "status":
      return { cmd, payload: { workspace: args.workspace, mission: args.mission } };
    case "recover":
      return { cmd, payload: { workspace: args.workspace } };
    case "run": {
      let input = null;
      if (args["goal-file"]) input = JSON.parse(fs.readFileSync(args["goal-file"], "utf8"));
      else { const raw = readStdin(); input = raw ? JSON.parse(raw) : null; }
      if (!input || !input.goal || !Array.isArray(input.acceptance) || !input.title) throw new Error("run needs JSON {title, goal, acceptance[]} via stdin or --goal-file");
      return { cmd, payload: { ...input, workspace: args.workspace, waitfor: args["wait-for"] === "completion" ? "completion" : "decision", markerDir: args["marker-dir"] } };
    }
    case "answer": {
      let input = null;
      if (args["answer-file"]) input = JSON.parse(fs.readFileSync(args["answer-file"], "utf8"));
      else { const raw = readStdin(); input = raw ? JSON.parse(raw) : null; }
      if (!input || !input.answer) throw new Error("answer needs JSON {answer, question?} via stdin or --answer-file");
      return { cmd, payload: { missionId: args.mission, answer: input.answer, question: input.question, workspace: args.workspace } };
    }
    default:
      throw new Error(`usage: harness.mjs <doctor|run|status|answer|recover|ping|shutdown> [--goal-file --answer-file --mission --wait-for --marker-dir --workspace]`);
  }
}

const args = parseArgs(process.argv.slice(2));
let req;
try { req = buildRequest(args); } catch (e) { console.error(String(e)); process.exit(2); }

const sock = net.connect(socketPath());
sock.setEncoding("utf8");
let buf = "";
sock.on("connect", () => sock.write(JSON.stringify({ id: "cli-1", ...req }) + "\n"));
sock.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === "progress") {
      const ev = obj.event || {};
      if (ev.type === "text_delta") process.stderr.write(ev.delta || "");
      else if (ev.type === "tool") process.stderr.write(`\n[tool] ${ev.name}\n`);
    } else if (obj.type === "response") {
      process.stdout.write(JSON.stringify(obj.data ?? { success: obj.success, error: obj.error }, null, 2) + "\n");
      sock.end();
      process.exit(obj.success ? 0 : 1);
    }
  }
});
sock.on("error", (e) => { console.error(`harness: cannot reach host at ${socketPath()}: ${e.message}`); process.exit(3); });
setTimeout(() => { console.error("harness: timeout waiting for host response"); process.exit(4); }, 30 * 60 * 1000);
