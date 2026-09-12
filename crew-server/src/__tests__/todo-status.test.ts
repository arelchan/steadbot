/**
 * 事项四态是产品对用户的承诺（日程右栏就是这四叠）。但状态怎么流转，全仓没有一处校验——
 * 唯一的收口是 patchTodo 的 Object.assign，九个调用点各写各的。这里测的是那条自动路径：
 * 问话／等确认不该把已经了结的事项复活。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CrewStore } from '../store.ts';
import type { Snapshot } from '../types.ts';

const seed = (): Snapshot => ({ bots: [], matters: [], todos: [], events: [], pendings: [], actions: [], messages: [], sharedProfile: [], integrations: [] });
const fresh = () => new CrewStore(join(mkdtempSync(join(tmpdir(), 'crew-test-')), 'crew.json'), seed);
const withTodo = (status: 'doing' | 'waiting' | 'done' | 'closed') => {
  const s = fresh();
  const t = s.addTodo({ botId: 'b1', title: '订机票', status });
  return { s, id: t.id };
};

test('在做／等你的，问话时会挂起', () => {
  for (const st of ['doing', 'waiting'] as const) {
    const { s, id } = withTodo(st);
    assert.equal(s.parkTodo(id, '等你拍板')?.status, 'waiting');
    assert.equal(s.todo(id)!.summary, '等你拍板');
  }
});

test('已完成／已关闭的不会被问话复活', () => {
  for (const st of ['done', 'closed'] as const) {
    const { s, id } = withTodo(st);
    assert.equal(s.parkTodo(id, '等你拍板'), undefined);
    assert.equal(s.todo(id)!.status, st, `${st} 不该被改动`);
  }
});

test('不存在的事项不会凭空造一条出来', () => {
  const s = fresh();
  assert.equal(s.parkTodo('没有这条', 'x'), undefined);
});

test('人／模型明确重开走 patchTodo，那条路仍然通', () => {
  const { s, id } = withTodo('done');
  assert.equal(s.patchTodo(id, { status: 'doing' })?.status, 'doing');
});

test('五态的老数据在加载时并成四态', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-test-'));
  const file = join(dir, 'crew.json');
  const a = new CrewStore(file, seed);
  a.addTodo({ botId: 'b1', title: '老的开着', status: 'doing' });
  a.addTodo({ botId: 'b1', title: '老的卡着', status: 'waiting' });
  // 直接写成旧的五态，模拟老装机
  (a.data.todos[0] as { status: string }).status = 'open';
  (a.data.todos[1] as { status: string }).status = 'blocked';
  a.flush();
  const b = new CrewStore(file, seed);
  assert.deepEqual(b.data.todos.map((t) => t.status), ['doing', 'waiting']);
});

test('crew.json 坏了不至于让服务起不来', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-test-'));
  const file = join(dir, 'crew.json');
  const a = new CrewStore(file, seed);
  a.addTodo({ botId: 'b1', title: 'x', status: 'doing' });
  a.flush();
  writeFileSync(file, '{"bots":[ 半截');
  const b = new CrewStore(file, seed);
  assert.equal(b.data.todos.length, 0, '从种子起');
  const kept = readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.equal(kept.length, 1, '坏文件要留在一边当证据');
});

test('消息搬进追加文件：老装机自动迁移，原件留着当回滚素材', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-test-'));
  const file = join(dir, 'crew.json');
  const a = new CrewStore(file, seed);
  for (let i = 0; i < 5; i++) a.addMessage({ threadId: 'bot:b1', author: 'user', text: '第 ' + i + ' 条', ts: 1000 + i });
  a.flush();
  // 模拟老装机：把消息塞回 crew.json，删掉追加文件
  const snap = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  snap.messages = a.data.messages;
  writeFileSync(file, JSON.stringify(snap));
  rmSync(file.replace(/\.json$/, '') + '.messages.jsonl');

  const b = new CrewStore(file, seed);
  assert.equal(b.data.messages.length, 5, '迁移后消息一条不少');
  const names = readdirSync(dir);
  assert.ok(names.some((f) => f.endsWith('.messages.jsonl')), '追加文件建起来了');
  assert.ok(names.some((f) => f.endsWith('.pre-split')), '原 crew.json 留着——它是唯一的回滚素材');
});

test('crew.json 里不再有消息，大小不随历史长', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-test-'));
  const file = join(dir, 'crew.json');
  const s = new CrewStore(file, seed);
  s.addMessage({ threadId: 'bot:b1', author: 'user', text: 'x', ts: 1 });
  s.flush();
  const small = readFileSync(file, 'utf8').length;
  for (let i = 0; i < 300; i++) s.addMessage({ threadId: 'bot:b1', author: 'user', text: '塞满'.repeat(50), ts: 2 + i });
  s.flush();
  assert.equal(readFileSync(file, 'utf8').length, small, 'crew.json 不该因为多了 300 条消息而变大');
  assert.equal(new CrewStore(file, seed).data.messages.length, 301, '重新加载读得回来');
});

test('追加写被截断的那一行丢掉，不丢整个文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-test-'));
  const file = join(dir, 'crew.json');
  const s = new CrewStore(file, seed);
  for (let i = 0; i < 3; i++) s.addMessage({ threadId: 'bot:b1', author: 'user', text: 'm' + i, ts: i });
  s.flush();
  const jsonl = file.replace(/\.json$/, '') + '.messages.jsonl';
  writeFileSync(jsonl, readFileSync(jsonl, 'utf8') + '{"id":"半截\n');
  assert.equal(new CrewStore(file, seed).data.messages.length, 3);
});

test('改一条消息之后重新加载，改动还在', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-test-'));
  const file = join(dir, 'crew.json');
  const s = new CrewStore(file, seed);
  const m = s.addMessage({ threadId: 'bot:b1', author: 'bot', botId: 'b1', text: '原文', ts: 1 });
  s.addMessage({ threadId: 'bot:b1', author: 'user', text: '后一条', ts: 2 });
  s.patchMessage(m.id, { text: '改过了' });
  s.flush();
  const b = new CrewStore(file, seed);
  assert.equal(b.data.messages.length, 2, '重写之后不能多也不能少');
  assert.equal(b.message(m.id)!.text, '改过了');
});
