import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class PiRpc extends EventEmitter {
  constructor({ cwd, model, thinking = 'medium', sessionDir, session = null, name = 'executor-parent' }) {
    super();
    this.cwd = cwd;
    this.model = model;
    this.thinking = thinking;
    this.sessionDir = sessionDir;
    this.session = session;
    this.name = name;
    this.proc = null;
    this.pid = null;
    this.buf = '';
    this.reqSeq = 0;
    this.pending = new Map();
    this.stderrBuf = [];
    this.exited = false;
    this.exitInfo = null;
    this.sessionId = null;
    this.sessionFile = null;
  }

  start() {
    const args = ['--mode', 'rpc'];
    if (this.model) args.push('--model', this.model);
    if (this.thinking) args.push('--thinking', this.thinking);
    if (this.sessionDir) args.push('--session-dir', this.sessionDir);
    if (this.session) args.push('--session', this.session);
    if (this.name) args.push('--name', this.name);

    this.proc = spawn('pi', args, { cwd: this.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pid = this.proc.pid;
    this.proc.stdout.on('data', (d) => this.#onData(d.toString('utf8')));
    this.proc.stderr.on('data', (d) => {
      const s = d.toString('utf8');
      this.stderrBuf.push(s);
      if (this.stderrBuf.length > 300) this.stderrBuf.shift();
      this.emit('stderr', s);
    });
    this.proc.on('error', (e) => {
      this.exited = true;
      this.exitInfo = { error: String(e?.message || e) };
      this.#resolvePendingOnExit();
      this.emit('exit', this.exitInfo);
    });
    this.proc.on('exit', (code, signal) => {
      this.exited = true;
      this.exitInfo = { code, signal };
      this.#resolvePendingOnExit();
      this.emit('exit', this.exitInfo);
    });
    return this;
  }

  #resolvePendingOnExit() {
    for (const [, p] of this.pending) {
      p.resolve({ type: 'response', command: p.command, success: false, error: `pi exited (${this.exitInfo?.signal || this.exitInfo?.code || this.exitInfo?.error || 'unknown'})` });
    }
    this.pending.clear();
  }

  #onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      let line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); }
      catch { this.emit('badline', line.slice(0, 300)); continue; }
      if (obj.type === 'response') {
        const p = obj.id && this.pending.get(obj.id);
        if (p) {
          this.pending.delete(obj.id);
          p.resolve(obj);
        } else {
          this.emit('response', obj);
        }
      } else {
        this.emit('event', obj);
        this.emit(obj.type, obj);
      }
    }
  }

  send(command) {
    if (!this.proc || this.exited) return Promise.resolve({ success: false, error: 'pi rpc is not alive' });
    const id = `req-${++this.reqSeq}`;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, command: command.type });
      this.proc.stdin.write(JSON.stringify({ ...command, id }) + '\n');
    });
  }

  getState() { return this.send({ type: 'get_state' }); }
  getLastAssistantText() { return this.send({ type: 'get_last_assistant_text' }); }
  prompt(message) { return this.send({ type: 'prompt', message }); }

  waitEvent(type, timeoutMs) {
    return new Promise((resolve, reject) => {
      const handler = (event) => {
        clearTimeout(timer);
        this.off(type, handler);
        resolve(event);
      };
      const timer = setTimeout(() => {
        this.off(type, handler);
        reject(new Error(`timeout waiting ${type}`));
      }, timeoutMs);
      this.on(type, handler);
    });
  }

  async initialize() {
    const state = await this.getState();
    if (!state?.success || !state.data) throw new Error(`pi get_state failed: ${state?.error || 'unknown'}`);
    this.sessionId = state.data.sessionId || null;
    this.sessionFile = state.data.sessionFile || null;
    return state.data;
  }

  tailStderr(n = 20) { return this.stderrBuf.slice(-n).join(''); }

  stop() {
    if (!this.proc || this.exited) return;
    try { this.proc.stdin.write(JSON.stringify({ type: 'abort' }) + '\n'); } catch {}
    try { this.proc.kill('SIGTERM'); } catch {}
  }
}
