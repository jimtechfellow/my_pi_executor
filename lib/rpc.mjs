// Thin Pi RPC client: spawns `pi --mode rpc`, speaks the official JSONL protocol.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { MODEL, THINKING, SESSION_DIR } from "./const.mjs";

export class PiRpc extends EventEmitter {
  constructor({ cwd, name = "executor-harness-parent" }) {
    super();
    this.cwd = cwd;
    this.name = name;
    this.proc = null;
    this.pid = null;
    this.buf = "";
    this.reqSeq = 0;
    this.pending = new Map(); // id -> {resolve, command}
    this.stderrBuf = [];
    this.exited = false;
    this.exitInfo = null;
    this.model = null;
    this.sessionId = null;
    this.sessionFile = null;
  }

  start() {
    const args = ["--mode", "rpc", "--model", MODEL, "--thinking", THINKING, "--session-dir", SESSION_DIR, "--name", this.name];
    this.proc = spawn("pi", args, { cwd: this.cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    this.pid = this.proc.pid;
    this.proc.stdout.on("data", (d) => this._onData(d.toString("utf8")));
    this.proc.stderr.on("data", (d) => {
      this.stderrBuf.push(d.toString("utf8"));
      if (this.stderrBuf.length > 300) this.stderrBuf.shift();
      this.emit("stderr", d.toString("utf8"));
    });
    this.proc.on("error", (e) => { this.exited = true; this.exitInfo = { error: String(e.message || e) }; this.emit("exit", this.exitInfo); });
    this.proc.on("exit", (code, signal) => {
      this.exited = true;
      this.exitInfo = { code, signal };
      for (const [, p] of this.pending) p.resolve({ type: "response", command: p.command, success: false, error: `pi exited (${signal || code})` });
      this.pending.clear();
      this.emit("exit", this.exitInfo);
    });
    return this;
  }

  _onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      let line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { this.emit("badline", line.slice(0, 200)); continue; }
      if (obj.type === "response") {
        const p = obj.id && this.pending.get(obj.id);
        if (p) { this.pending.delete(obj.id); p.resolve(obj); }
        else this.emit("response", obj);
      } else {
        this.emit("event", obj);
        this.emit(obj.type, obj);
      }
    }
  }

  send(command, id) {
    const rid = id || `req-${++this.reqSeq}`;
    return new Promise((resolve) => {
      this.pending.set(rid, { resolve, command: command.type });
      this.proc.stdin.write(JSON.stringify({ ...command, id: rid }) + "\n");
    });
  }
  getState() { return this.send({ type: "get_state" }); }
  getLastAssistantText() { return this.send({ type: "get_last_assistant_text" }); }
  getCommands() { return this.send({ type: "get_commands" }); }
  prompt(text, streamingBehavior) {
    const c = { type: "prompt", message: text };
    if (streamingBehavior) c.streamingBehavior = streamingBehavior;
    return this.send(c);
  }
  waitEvent(type, timeoutMs) {
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { this.off(type, h); reject(new Error(`timeout waiting ${type}`)); }, timeoutMs);
      const h = (e) => { clearTimeout(to); this.off(type, h); resolve(e); };
      this.on(type, h);
    });
  }
  tailStderr(n = 10) { return this.stderrBuf.slice(-n).join(""); }
  stop() {
    try { this.proc.stdin.write(JSON.stringify({ type: "abort" }) + "\n"); } catch {}
    try { this.proc.kill("SIGTERM"); } catch {}
  }
}
