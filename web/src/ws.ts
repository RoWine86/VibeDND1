// WebSocket-клиент с автореконнектом. Используется всеми тремя представлениями.
import type { ClientMsg, Role, ServerMsg } from '@vibednd/shared';

type Handler = (msg: ServerMsg) => void;

export class SessionSocket {
  private ws?: WebSocket;
  private handlers = new Set<Handler>();
  private reconnectTimer?: number;
  private closedByUser = false;

  constructor(
    private role: Role,
    private sessionId: string,
    private characterId?: string,
  ) {
    this.connect();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      const hello: ClientMsg = {
        type: 'hello',
        role: this.role,
        sessionId: this.sessionId,
        characterId: this.characterId,
      };
      this.ws!.send(JSON.stringify(hello));
    };
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMsg;
      this.handlers.forEach((h) => h(msg));
    };
    this.ws.onclose = () => {
      if (this.closedByUser) return;
      this.reconnectTimer = window.setTimeout(() => this.connect(), 1500);
    };
  }

  onMessage(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close() {
    this.closedByUser = true;
    window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
