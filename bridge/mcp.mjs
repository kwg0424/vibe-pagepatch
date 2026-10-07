#!/usr/bin/env node
// PagePatch MCP 서버. Claude Code 가 stdio 로 띄운다.
//   - 사이드바 채팅: host.mjs 가 claude -p 를 띄울 때 --mcp-config 로 붙인다 (PAGEPATCH_TAB = 그 채팅의 탭)
//   - 터미널: claude mcp add --scope user pagepatch -- node <이 파일>   (install.ps1 -WithMcp)
// 도구 요청은 host.mjs(127.0.0.1, bridge.json 의 포트·토큰)를 거쳐 Edge 의 PagePatch 확장으로 간다.
import readline from "node:readline";
import { BRIDGE_FILE, readJson, VERSION } from "./common.mjs";
import { TOOLS, TAB_TOOLS, INSTRUCTIONS } from "./tooldefs.mjs";

const DEFAULT_TAB = Number(process.env.PAGEPATCH_TAB) || undefined;
const NOT_RUNNING = "PagePatch 브리지에 연결할 수 없습니다. Edge 가 켜져 있고 PagePatch 설정 → Claude Code 연결이 켜져 있어야 합니다 (처음이면 설정 → AI Code 의 등록 명령 실행)";

let ready = null;
const waiting = new Map();
let seq = 1;

function connect() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const b = readJson(BRIDGE_FILE);
    if (!b?.port || !b?.token) return reject(new Error(NOT_RUNNING));
    let sock;
    try {
      sock = new WebSocket(`ws://127.0.0.1:${b.port}/mcp`);
    } catch {
      return reject(new Error(NOT_RUNNING));
    }
    sock.onopen = () => sock.send(JSON.stringify({ type: "auth", token: b.token }));
    sock.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.type === "ready") resolve(sock);
      else if (m.type === "result") {
        const w = waiting.get(m.id);
        if (!w) return;
        waiting.delete(m.id);
        if (m.error) w.reject(new Error(m.error));
        else w.resolve(m.result);
      }
    };
    sock.onerror = () => {};
    sock.onclose = () => {
      ready = null;
      reject(new Error(NOT_RUNNING));
      for (const w of waiting.values()) w.reject(new Error("PagePatch 브리지 연결이 끊겼습니다"));
      waiting.clear();
    };
  });
  ready.catch(() => (ready = null));
  return ready;
}

async function call(tool, args) {
  const sock = await connect();
  const id = seq++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    sock.send(JSON.stringify({ type: "call", id, tool, args }));
    setTimeout(() => {
      if (waiting.delete(id)) reject(new Error("응답 시간 초과 (60초)"));
    }, 60000);
  });
}

function toContent(result) {
  if (result && typeof result.image === "string") {
    const [, mimeType = "image/jpeg", data = ""] = /^data:([^;]+);base64,(.*)$/s.exec(result.image) || [];
    const { image, ...rest } = result;
    return [
      { type: "image", data, mimeType },
      { type: "text", text: JSON.stringify(rest) },
    ];
  }
  return [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }];
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // 알림
  try {
    if (method === "initialize") {
      return send({
        jsonrpc: "2.0",
        id,
        result: { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "pagepatch", version: VERSION }, instructions: INSTRUCTIONS },
      });
    }
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (method === "tools/call") {
      const name = params?.name;
      if (!TOOLS.some((t) => t.name === name)) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `알 수 없는 도구: ${name}` } });
      const args = { ...(params.arguments || {}) };
      if (DEFAULT_TAB && TAB_TOOLS.has(name) && args.tabId === undefined) args.tabId = DEFAULT_TAB;
      try {
        return send({ jsonrpc: "2.0", id, result: { content: toContent(await call(name, args)) } });
      } catch (e) {
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `오류: ${e.message}` }], isError: true } });
      }
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `지원하지 않는 메서드: ${method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
  }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  handle(msg);
});
process.stdin.on("end", () => process.exit(0));
