import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';

/**
 * Local bridge to the Hermit Figma plugin.
 *
 * Figma's REST API cannot create frames or layers — only the Plugin API can, and
 * that runs inside Figma. The plugin opens a WebSocket to this process; tools
 * post a scene-graph spec and await the plugin's result.
 *
 * Bound to loopback only. The bridge carries design content, and there is no
 * reason for it to be reachable off the machine.
 */
export class FigmaBridge {
  constructor({ port = 8473, token = null } = {}) {
    this.port = port;
    this.token = token;
    this.wss = null;
    this.socket = null;
    this.pending = new Map();
    this.clientInfo = null;
  }

  start() {
    if (this.wss) return;
    this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' });

    this.wss.on('connection', (ws, req) => {
      if (this.token) {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.searchParams.get('token') !== this.token) {
          ws.close(4001, 'bad token');
          return;
        }
      }
      // One plugin at a time: two Figma sessions writing the same page is not a
      // scenario with a sensible resolution.
      if (this.socket && this.socket.readyState === 1) {
        ws.close(4002, 'a Figma plugin is already connected to this bridge');
        return;
      }
      this.socket = ws;

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === 'hello') {
          this.clientInfo = { fileKey: msg.fileKey, fileName: msg.fileName, user: msg.user, pluginVersion: msg.pluginVersion };
          return;
        }
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        msg.ok ? entry.resolve(msg.result) : entry.reject(new Error(msg.error ?? 'plugin reported an unspecified failure'));
      });

      ws.on('close', () => {
        if (this.socket === ws) { this.socket = null; this.clientInfo = null; }
      });
      ws.on('error', () => {});
    });

    this.wss.on('error', (err) => {
      // A port clash should degrade to "disconnected", not crash the MCP server.
      process.stderr.write(`[hermit-figma] bridge could not listen on ${this.port}: ${err.message}\n`);
      this.wss = null;
    });
  }

  get connected() {
    return Boolean(this.socket && this.socket.readyState === 1);
  }

  status() {
    return {
      state: this.connected ? 'connected' : 'disconnected',
      port: this.port,
      client: this.clientInfo,
      hint: this.connected
        ? 'The Hermit plugin is connected; figma_create_design will build real frames.'
        : 'No Figma plugin connected. Open your file in Figma and run the Hermit plugin. ' +
          'Until then, record the design spec in the ux-hifi artifact and continue — do not retry in a loop.'
    };
  }

  send(command, payload, { timeoutMs = 60_000 } = {}) {
    if (!this.connected) return Promise.reject(new Error('Figma bridge is not connected.'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Figma plugin did not respond within ${timeoutMs / 1000}s. The file may be large, or the plugin may have been closed.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, command, payload }));
    });
  }

  stop() {
    this.wss?.close();
    this.wss = null;
    this.socket = null;
  }
}
