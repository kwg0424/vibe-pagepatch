// 아주 작은 WebSocket 서버 (외부 패키지 없이). 텍스트 메시지만 쓴다.
// host.mjs 가 127.0.0.1 에서 MCP 클라이언트(mcp.mjs)를 받을 때 쓴다.
import crypto from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// http 서버의 'upgrade' 에서 부른다 → { send, close, onMessage, onClose } 또는 null(거절)
export function acceptWebSocket(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key || req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return null;
  }
  const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  const conn = { onMessage: () => {}, onClose: () => {}, closed: false };
  let buf = Buffer.alloc(0);
  let fragments = [];

  const frame = (opcode, payload) => {
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | opcode;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | opcode;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    if (!socket.destroyed) socket.write(Buffer.concat([head, payload]));
  };

  conn.send = (text) => frame(0x1, Buffer.from(text, "utf8"));
  conn.close = () => {
    if (conn.closed) return;
    conn.closed = true;
    frame(0x8, Buffer.alloc(0));
    socket.end();
  };

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.subarray(off, off + len);
      if (masked) {
        const mask = buf.subarray(maskOff, maskOff + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      }
      buf = buf.subarray(off + len);

      if (opcode === 0x8) {
        conn.close();
        return;
      }
      if (opcode === 0x9) {
        frame(0xa, payload);
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(fragments).toString("utf8");
          fragments = [];
          try {
            conn.onMessage(text);
          } catch {}
        }
      }
    }
  });
  const closed = () => {
    if (conn.closedNotified) return;
    conn.closedNotified = true;
    conn.closed = true;
    conn.onClose();
  };
  socket.on("close", closed);
  socket.on("error", closed);
  return conn;
}
