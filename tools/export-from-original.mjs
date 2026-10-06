#!/usr/bin/env node
// 원본 확장 "User JavaScript and CSS" 의 저장소(LevelDB)에서 규칙을 뽑아 JSON 으로 저장한다.
// PagePatch 설정 → 데이터 → 가져오기 에서 이 파일을 고르면 된다.
//
//   node tools/export-from-original.mjs [출력 파일] [Edge 프로필 폴더]
//
// 기본 프로필: %LOCALAPPDATA%\Microsoft\Edge\User Data\Default
// Edge 를 켜 둔 채로 실행해도 읽기만 하므로 괜찮다. (최근 변경이 아직 파일에 안 쓰였을 수 있으니 가능하면 Edge 를 끄고)

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ORIGINAL_ID = "nbhcbdghjpllgmfilhnhkllmkecfmpld";
const out = process.argv[2] || path.join(os.homedir(), "Downloads", "pagepatch-original-rules.json");
const profile =
  process.argv[3] || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Microsoft", "Edge", "User Data", "Default");
const dir = path.join(profile, "Local Extension Settings", ORIGINAL_ID);

if (!fs.existsSync(dir)) {
  console.error(`원본 확장 저장소가 없습니다: ${dir}`);
  process.exit(1);
}

// LevelDB 로그 파일(.log) 읽기: 32KB 블록 → 레코드(FULL/FIRST/MIDDLE/LAST) → WriteBatch(put/delete)
function readLog(file, db) {
  const buf = fs.readFileSync(file);
  const BLOCK = 32768;
  let pos = 0;
  let pending = null;
  while (pos + 7 <= buf.length) {
    const left = BLOCK - (pos % BLOCK);
    if (left < 7) {
      pos += left;
      continue;
    }
    const len = buf.readUInt16LE(pos + 4);
    const type = buf[pos + 6];
    const data = buf.subarray(pos + 7, pos + 7 + len);
    pos += 7 + len;
    if (type === 0 && len === 0) continue; // 빈 영역
    if (type === 1) applyBatch(data, db);
    else if (type === 2) pending = [data];
    else if (type === 3 && pending) pending.push(data);
    else if (type === 4 && pending) {
      pending.push(data);
      applyBatch(Buffer.concat(pending), db);
      pending = null;
    }
  }
}

function varint(buf, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return [result >>> 0, pos];
    shift += 7;
  }
}

function applyBatch(batch, db) {
  let pos = 12; // sequence(8) + count(4)
  const count = batch.readUInt32LE(8);
  for (let i = 0; i < count && pos < batch.length; i++) {
    const tag = batch[pos++];
    let len;
    [len, pos] = varint(batch, pos);
    const key = batch.subarray(pos, pos + len).toString("utf8");
    pos += len;
    if (tag === 1) {
      [len, pos] = varint(batch, pos);
      db.set(key, batch.subarray(pos, pos + len).toString("utf8"));
      pos += len;
    } else db.delete(key);
  }
}

const files = fs.readdirSync(dir);
if (files.some((f) => f.endsWith(".ldb") || f.endsWith(".sst"))) {
  console.warn("주의: 압축된 테이블 파일(.ldb)이 있습니다. 이 도구는 로그(.log)만 읽으므로 일부 규칙이 빠질 수 있습니다.");
  console.warn("      원본 확장의 설정 화면에서 'Download JSON' 으로 내보낸 파일을 쓰세요.");
}
const db = new Map();
for (const f of files.filter((f) => f.endsWith(".log")).sort()) readLog(path.join(dir, f), db);

const dump = { exportedFrom: "User JavaScript and CSS", exportedAt: new Date().toISOString() };
for (const [k, v] of db) {
  try {
    dump[k] = JSON.parse(v);
  } catch {
    dump[k] = v;
  }
}
if (!Array.isArray(dump.rules)) {
  console.error("규칙 목록(rules)을 찾지 못했습니다.");
  process.exit(1);
}
fs.writeFileSync(out, JSON.stringify(dump, null, 2));
console.log(`규칙 ${dump.rules.length}개, 라이브러리 ${(dump.libs || []).length}개 → ${out}`);
