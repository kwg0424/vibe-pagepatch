#!/usr/bin/env node
// PagePatch 네이티브 메시징 호스트. Edge(PagePatch 확장)가 띄우고, Edge 가 연결을 끊으면 끝난다.
//   1. 사이드바 채팅: claude -p 를 띄워 대화하고, 진행 상황을 확장으로 보낸다
//   2. 도구 중계: 127.0.0.1 에서 mcp.mjs(Claude Code 의 MCP 서버)를 받아, 도구 요청을 확장으로 넘긴다
//      접속하려면 bridge.json 의 토큰이 필요하다 (이 PC 사용자만 읽을 수 있는 폴더). 브라우저 페이지(Origin 있음)는 거절.
// 확장 ↔ 호스트: 네이티브 메시징 (4바이트 길이 + JSON). 호스트 → 확장 메시지는 1MB 까지.
// stdout 은 확장과의 통신 전용 → 기록은 host.log 로만.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acceptWebSocket } from "./ws.mjs";
import { VERSION, DATA_DIR, BRIDGE_FILE, CONFIG_FILE, LOG_FILE, WORK_DIR, DEFAULT_PORT, readJson } from "./common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_PATH = path.join(HERE, "mcp.mjs");
fs.mkdirSync(WORK_DIR, { recursive: true });

function log(...a) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${a.join(" ")}\n`);
  } catch {}
}
console.log = console.info = console.warn = console.error = (...a) => log(...a);
process.on("uncaughtException", (e) => log("uncaught", e?.stack || e));
process.on("unhandledRejection", (e) => log("unhandled", e?.stack || e));

// ── 확장과 통신 (네이티브 메시징) ──
let inBuf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  inBuf = Buffer.concat([inBuf, chunk]);
  while (inBuf.length >= 4) {
    const len = inBuf.readUInt32LE(0);
    if (inBuf.length < 4 + len) break;
    const body = inBuf.subarray(4, 4 + len).toString("utf8");
    inBuf = inBuf.subarray(4 + len);
    try {
      onExtMessage(JSON.parse(body));
    } catch (e) {
      log("bad message", e?.message);
    }
  }
});
process.stdin.on("end", shutdown);

function toExt(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  if (body.length > 1024 * 1024) {
    log("message too big", msg.type, body.length);
    return;
  }
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

let extReady = false;

function onExtMessage(msg) {
  if (msg.type === "hello") {
    extReady = true;
    toExt({ type: "hello", version: VERSION, claude: findClaude(), port: hubPort });
  } else if (msg.type === "result") {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    p.conn.send(JSON.stringify({ type: "result", id: p.reqId, result: msg.result, error: msg.error }));
  } else if (msg.type === "chat") startChat(msg);
  else if (msg.type === "chat-cancel") cancelChat(msg.chatId);
}

// ── MCP 클라이언트 받기 (127.0.0.1 WebSocket) ──
const token = crypto.randomBytes(24).toString("hex");
const pending = new Map(); // 확장에 보낸 요청 id → { conn, reqId, timer }
let nextId = 1;
let hubPort = null;

const safeEqual = (a, b) => typeof a === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const server = http.createServer((req, res) => {
  res.writeHead(404);
  res.end();
});
server.on("upgrade", (req, socket) => {
  // 브라우저에서 온 연결(Origin 있음)은 받지 않는다 → 웹페이지가 로컬 포트로 들어오는 것을 막는다
  if (req.headers.origin || req.url !== "/mcp") {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const conn = acceptWebSocket(req, socket);
  if (!conn) return;
  let authed = false;
  conn.onMessage = (text) => {
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (!authed) {
      if (m.type === "auth" && safeEqual(m.token, token)) {
        authed = true;
        conn.send(JSON.stringify({ type: "ready" }));
      } else conn.close();
      return;
    }
    if (m.type !== "call") return;
    if (!extReady) {
      conn.send(JSON.stringify({ type: "result", id: m.id, error: "Edge 의 PagePatch 가 연결되지 않았습니다" }));
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      conn.send(JSON.stringify({ type: "result", id: m.id, error: "확장 응답 시간 초과" }));
    }, 55000);
    pending.set(id, { conn, reqId: m.id, timer });
    toExt({ type: "call", id, tool: m.tool, args: m.args || {} });
  };
  conn.onClose = () => {
    for (const [id, p] of pending) {
      if (p.conn !== conn) continue;
      clearTimeout(p.timer);
      pending.delete(id);
    }
  };
});

function listen(port, tries = 10) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && tries > 1) listen(port + 1, tries - 1);
    else log("listen failed", e.message);
  });
  server.listen(port, "127.0.0.1", () => {
    hubPort = port;
    fs.writeFileSync(BRIDGE_FILE, JSON.stringify({ port, token, pid: process.pid, version: VERSION }));
    log(`listening 127.0.0.1:${port}`);
  });
}
listen(DEFAULT_PORT);

// ── 사이드바 채팅 (claude -p) ──
const chats = new Map(); // chatId → child

function findClaude() {
  const cfg = readJson(CONFIG_FILE);
  if (cfg?.claude && fs.existsSync(cfg.claude)) return cfg.claude;
  const names = process.platform === "win32" ? ["claude.exe"] : ["claude"];
  const dirs = [...(process.env.PATH || "").split(path.delimiter), path.join(os.homedir(), ".local", "bin")];
  for (const d of dirs) for (const n of names) if (d && fs.existsSync(path.join(d, n))) return path.join(d, n);
  return null;
}

let skillText = null;
function systemPrompt() {
  if (skillText === null) {
    try {
      skillText = fs.readFileSync(path.join(HERE, "SKILL.md"), "utf8").replace(/^---[\s\S]*?---\s*/, "");
    } catch {
      skillText = "";
    }
  }
  return `너는 Edge 브라우저 오른쪽 사이드바의 PagePatch 도우미다. 사용자는 웹페이지를 보면서 너와 대화하고, 너는 PagePatch 도구로 그 페이지의 디자인과 동작을 실시간으로 바꾼다.
파일 읽기·쓰기, 명령 실행 같은 다른 도구는 없다. 답은 사이드바(좁은 화면)에 나오므로 짧게 쓴다.
사용자가 바꿔 달라고 하면 css_preview 로 바로 보여 주고, "저장"·"좋아" 같은 말을 하면 rule_save 로 저장한다.

${skillText}`;
}

const short = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const toolName = (n) => String(n || "").replace(/^mcp__pagepatch__/, "");

function inputSummary(input = {}) {
  const v = input.selector || input.css || input.js || input.code || input.urls || input.name || input.id || "";
  return short(String(v).replace(/\s+/g, " ").trim(), 120);
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (c.type === "text" ? c.text : c.type === "image" ? "[이미지]" : "")).join(" ");
}

function startChat({ chatId, text, sessionId, tab }) {
  const claude = findClaude();
  const end = (extra) => {
    chats.delete(chatId);
    toExt({ type: "chat-end", chatId, ...extra });
  };
  if (!claude) return end({ error: "Claude Code(claude)를 찾지 못했습니다. 설치한 뒤 PagePatch 설정 → AI Code 의 등록 명령을 다시 실행하세요" });

  const mcpConfig = JSON.stringify({
    mcpServers: { pagepatch: { type: "stdio", command: process.execPath, args: [MCP_PATH], env: { PAGEPATCH_TAB: String(tab?.id || "") } } },
  });
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools", "",
    "--strict-mcp-config",
    "--mcp-config", mcpConfig,
    "--allowedTools", "mcp__pagepatch",
    "--permission-mode", "dontAsk",
    "--append-system-prompt", systemPrompt(),
  ];
  if (sessionId) args.push("--resume", sessionId);
  const prompt = tab?.url ? `[지금 탭: ${tab.title || ""} — ${tab.url} (tabId ${tab.id})]\n\n${text}` : text;

  log("chat start", chatId, sessionId ? `resume ${sessionId}` : "new");
  let child;
  try {
    child = spawn(claude, args, { cwd: WORK_DIR, env: process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    return end({ error: `claude 실행 실패: ${e.message}` });
  }
  chats.set(chatId, child);
  child.stdin.end(prompt);

  let stderr = "";
  let ended = false;
  let newSession = sessionId || null;
  const emit = (event) => toExt({ type: "chat-event", chatId, event });

  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (o.type === "system" && o.subtype === "init") {
      newSession = o.session_id;
      emit({ kind: "session", sessionId: o.session_id, model: o.model });
    } else if (o.type === "stream_event") {
      const ev = o.event || {};
      if (ev.type === "message_start") emit({ kind: "message-start" });
      else if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") emit({ kind: "tool-start", name: toolName(ev.content_block.name) });
      else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") emit({ kind: "delta", text: ev.delta.text });
    } else if (o.type === "assistant") {
      for (const c of o.message?.content || []) {
        if (c.type === "text") emit({ kind: "text", text: c.text });
        else if (c.type === "tool_use") emit({ kind: "tool-call", id: c.id, name: toolName(c.name), summary: inputSummary(c.input) });
      }
    } else if (o.type === "user") {
      for (const c of o.message?.content || []) {
        if (c.type === "tool_result") emit({ kind: "tool-result", id: c.tool_use_id, isError: !!c.is_error, text: short(resultText(c.content), 300) });
      }
    } else if (o.type === "result") {
      ended = true;
      end({
        sessionId: o.session_id || newSession,
        error: o.is_error ? short(String(o.result || o.subtype || "오류"), 500) : null,
        cost: o.total_cost_usd,
        turns: o.num_turns,
      });
    }
  });
  child.on("error", (e) => {
    if (ended) return;
    ended = true;
    end({ sessionId: newSession, error: `claude 실행 실패: ${e.message}` });
  });
  child.on("close", (code) => {
    log("chat end", chatId, "code", code);
    if (ended) return;
    ended = true;
    end({ sessionId: newSession, error: code === null ? "중지했습니다" : short(stderr.trim() || `claude 가 끝났습니다 (코드 ${code})`, 800) });
  });
}

function cancelChat(chatId) {
  const child = chats.get(chatId);
  if (!child) return;
  try {
    child.kill();
  } catch {}
}

function shutdown() {
  for (const child of chats.values()) {
    try {
      child.kill();
    } catch {}
  }
  try {
    if (readJson(BRIDGE_FILE)?.pid === process.pid) fs.unlinkSync(BRIDGE_FILE);
  } catch {}
  server.close();
  process.exit(0);
}

log(`host ${VERSION} start (pid ${process.pid}, data ${DATA_DIR})`);
