/**
 * 凭据不靠类型挡，靠出门时剥。Bot.bindings 是每个 bot 在各 IM 里的私聊 chat id，
 * types.ts 上写着 server-only——但快照一直是 {...store.data} 原样发的，
 * 全文件唯一的 redact 只管 Integration.env，于是它一路到了浏览器还落了盘。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ws = readFileSync(fileURLToPath(new URL('../ws.ts', import.meta.url)), 'utf8');

test('快照里的 bots 过 toWire', () => {
  assert.match(ws, /state: \{ \.\.\.store\.data, bots: store\.data\.bots\.map\(toWire\)/, '快照没有剥 bindings');
});

test('单条 bot 广播也过 toWire（bot 和 bot_created 两种）', () => {
  const m = /const redactMsg[\s\S]*?;\n/.exec(ws)?.[0] ?? '';
  for (const kind of ["'bot'", "'bot_created'"]) {
    assert.ok(m.includes(kind), `${kind} 没有过 toWire`);
  }
});

test('toWire 真的把 bindings 抹掉', () => {
  const src = /const toWire = \(b: Bot\): Bot => ([^;]+);/.exec(ws)?.[1];
  assert.ok(src, '找不到 toWire');
  const toWire = new Function('b', `return ${src!.replace(/: Bot/g, '')}`) as (b: unknown) => { bindings?: unknown };
  assert.equal(toWire({ id: 'b1', bindings: { telegram: '12345' } }).bindings, undefined);
  assert.deepEqual(toWire({ id: 'b1', name: '助理' }), { id: 'b1', name: '助理' });
});

test('Integration.env 那条老的保护还在', () => {
  assert.match(ws, /redact\(m\.integration\)/);
  assert.match(ws, /integrations: store\.data\.integrations\.map\(redact\)/);
});
