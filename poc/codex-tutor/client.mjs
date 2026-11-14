// M1-A throwaway PoC: minimal Codex App Server JSON-RPC client over stdio.
// Not production code. Mirrors the shape planned in docs/design/ai-system.md.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Responses that refuse every server-initiated request (tutor never uses tools). */
const DENY = {
  'item/commandExecution/requestApproval': () => ({ decision: 'decline' }),
  'item/fileChange/requestApproval': () => ({ decision: 'decline' }),
  'item/permissions/requestApproval': () => ({ permissions: {}, scope: 'turn' }),
  'mcpServer/elicitation/request': () => ({ action: 'decline', content: null }),
  'item/tool/requestUserInput': () => ({ answers: {} }),
  'item/tool/call': () => ({ success: false, contentItems: [] }),
  applyPatchApproval: () => ({ decision: 'denied' }),
  execCommandApproval: () => ({ decision: 'denied' }),
};

export class CodexClient {
  constructor({ env = process.env, args = [], log = () => {} } = {}) {
    this.log = log;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.serverRequests = [];
    this.stderr = [];
    this.proc = spawn('codex', ['app-server', ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise((r) => this.proc.on('exit', (code, sig) => r({ code, sig })));
    createInterface({ input: this.proc.stdout }).on('line', (l) => this.#onLine(l));
    createInterface({ input: this.proc.stderr }).on('line', (l) => this.stderr.push(l));
  }

  #onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { this.log('bad line', line.slice(0, 200)); return; }
    this.log('<-', msg);
    if (msg.id !== undefined && msg.method) {
      // Server -> client request: always refuse.
      const h = DENY[msg.method];
      this.serverRequests.push({ method: msg.method, params: msg.params, at: Date.now() });
      for (const l of this.listeners) l({ kind: 'serverRequest', method: msg.method, params: msg.params });
      if (h) this.#send({ id: msg.id, result: h(msg.params) });
      else this.#send({ id: msg.id, error: { code: -32601, message: 'Method not found' } });
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { rpc: msg.error }));
      else p.resolve(msg.result);
      return;
    }
    for (const l of this.listeners) l({ kind: 'notification', method: msg.method, params: msg.params });
  }

  #send(obj) {
    this.log('->', obj);
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  request(method, params, timeoutMs = 15000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.#send({ id, method, params });
    });
  }

  notify(method, params) { this.#send(params === undefined ? { method } : { method, params }); }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async initialize(optOut = []) {
    const res = await this.request('initialize', {
      clientInfo: { name: 'proginone_poc', title: 'ProgInOne PoC', version: '0.0.0' },
      capabilities: { experimentalApi: false, optOutNotificationMethods: optOut },
    });
    this.notify('initialized');
    return res;
  }

  /**
   * Run one turn and collect everything observable about it.
   * Returns timing (first delta), final text, items by type, server requests, token usage.
   */
  async runTurn(threadId, input, { outputSchema, effort, timeoutMs = 180000, interruptAfterMs } = {}) {
    const t0 = Date.now();
    const out = {
      text: '', firstDeltaMs: null, items: [], itemTypes: {}, serverRequests: [],
      status: null, error: null, usage: null, durationMs: null, notifications: {},
    };
    let turnId = null;
    let resolveDone;
    const done = new Promise((r) => (resolveDone = r));
    const off = this.on((ev) => {
      const p = ev.params || {};
      if (p.threadId && p.threadId !== threadId) return;
      if (ev.kind === 'serverRequest') { out.serverRequests.push({ method: ev.method, params: ev.params }); return; }
      out.notifications[ev.method] = (out.notifications[ev.method] || 0) + 1;
      switch (ev.method) {
        case 'item/agentMessage/delta':
          if (out.firstDeltaMs === null) out.firstDeltaMs = Date.now() - t0;
          out.text += p.delta;
          break;
        case 'item/completed':
          out.items.push(p.item);
          out.itemTypes[p.item.type] = (out.itemTypes[p.item.type] || 0) + 1;
          break;
        case 'thread/tokenUsage/updated':
          out.usage = p.tokenUsage ?? p;
          break;
        case 'error':
          out.error = p;
          break;
        case 'turn/completed':
          out.status = p.turn?.status;
          if (p.turn?.error) out.error = p.turn.error;
          resolveDone();
          break;
      }
    });
    const params = { threadId, input: [{ type: 'text', text: input, text_elements: [] }] };
    if (outputSchema) params.outputSchema = outputSchema;
    if (effort) params.effort = effort;
    const started = await this.request('turn/start', params);
    turnId = started?.turn?.id;
    let intTimer;
    if (interruptAfterMs) {
      intTimer = setTimeout(() => this.request('turn/interrupt', { threadId, turnId }).catch(() => {}), interruptAfterMs);
    }
    const timer = setTimeout(() => { out.status = 'client_timeout'; resolveDone(); }, timeoutMs);
    await done;
    clearTimeout(timer); clearTimeout(intTimer);
    off();
    out.durationMs = Date.now() - t0;
    out.turnId = turnId;
    // Prefer the completed agentMessage text if streaming was suppressed.
    const finalMsg = out.items.filter((i) => i.type === 'agentMessage').map((i) => i.text).join('\n');
    if (finalMsg) out.text = finalMsg;
    return out;
  }

  async close() {
    this.proc.stdin.end();
    const t = setTimeout(() => this.proc.kill('SIGTERM'), 3000);
    const r = await this.exited;
    clearTimeout(t);
    return r;
  }
}
