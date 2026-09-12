/**
 * 模型输出里抠 JSON。这段曾经被抄了四份，其中 infer-bot 那份漏了"根本没有括号"这一种
 * ——JSON.parse('') 抛出来被上层吞成一句误导的降级，而那条路径是 bot 出生。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonFromModel } from '../util.ts';

test('围栏、前后废话都剥掉', () => {
  assert.deepEqual(jsonFromModel('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(jsonFromModel('好的，我看了一下：\n```json\n{"a":1}\n```\n就这些'), { a: 1 });
  assert.deepEqual(jsonFromModel('{"a":1}'), { a: 1 });
});

test('根本没有 JSON：返回 undefined，不抛也不给空对象', () => {
  // 这一条就是原来的 bug：indexOf 返回 -1，slice(-1, 0) 得到空串，JSON.parse 抛 SyntaxError
  assert.equal(jsonFromModel('我不确定该怎么做。'), undefined);
  assert.equal(jsonFromModel(''), undefined);
  assert.equal(jsonFromModel('```json\n```'), undefined);
});

test('JSON 坏了也是 undefined，不是异常', () => {
  assert.equal(jsonFromModel('{"a":1,}'), undefined);
  assert.equal(jsonFromModel('{ 半截'), undefined);
});

test('数组模式', () => {
  assert.deepEqual(jsonFromModel('```json\n[{"n":1}]\n```', 'array'), [{ n: 1 }]);
  assert.equal(jsonFromModel('{"a":1}', 'array'), undefined);
});

test('只取最外层的那一对，中间有嵌套也不怕', () => {
  assert.deepEqual(jsonFromModel('前言 {"a":{"b":2}} 后记'), { a: { b: 2 } });
});
