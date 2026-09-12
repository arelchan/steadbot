/**
 * 事项四态是产品对用户的承诺（日程右栏就是这四叠）。但状态怎么流转，全仓没有一处校验——
 * 唯一的收口是 patchTodo 的 Object.assign，九个调用点各写各的。这里测的是那条自动路径：
 * 问话／等确认不该把已经了结的事项复活。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
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
