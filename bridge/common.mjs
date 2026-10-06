// host.mjs · mcp.mjs 가 같이 쓰는 경로와 설정.
//   %LOCALAPPDATA%\PagePatch\
//     config.json   install.ps1 이 만든다: { node, claude }
//     bridge.json   host.mjs 가 켜질 때 쓴다: { port, token, pid } → mcp.mjs 가 읽고 접속
//     host.log      host.mjs 기록 (문제 볼 때)
//     work\         사이드바 채팅의 claude 작업 폴더 (프로젝트 CLAUDE.md 를 읽지 않게 빈 폴더)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERSION = "1.0.0";
export const DATA_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "PagePatch");
export const BRIDGE_FILE = path.join(DATA_DIR, "bridge.json");
export const CONFIG_FILE = path.join(DATA_DIR, "config.json");
export const LOG_FILE = path.join(DATA_DIR, "host.log");
export const WORK_DIR = path.join(DATA_DIR, "work");
export const DEFAULT_PORT = 17345;

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
