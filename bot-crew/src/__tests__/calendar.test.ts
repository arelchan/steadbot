/**
 * 编辑器读写的那套写法，必须和服务端 scheduler.ts 的 lastDue 认得一样多。
 * 少认一种不是"显示得糙一点"：readWhen 认不出就回落成 DEFAULT_WHEN，
 * 用户一碰时间控件，writeWhen 就按每天 09:00 写回去——「每周天」和「每 N 小时」
 * 曾经就这么被悄悄改掉过，全程没有任何报错。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWhen, writeWhen, cadence } from '../calendar.ts';

/** 服务端 lastDue 认的全部写法，逐条抄在这里；crew-server 那侧有同一份。 */
const CANONICAL = ['每天 09:00', '工作日 18:00', '每周三 09:00', '每周日 09:00', '每周天 09:00', '每小时', '每 30 分钟', '每 2 小时'];

test('服务端认的，编辑器读写一遍不能变样', () => {
  for (const s of CANONICAL) {
    const back = writeWhen(readWhen(s));
    // 「每周天」是「每周日」的另一种写法，两边同一天，规范化成后者可以接受
    const same = back === s || (s === '每周天 09:00' && back === '每周日 09:00');
    assert.ok(same, `${s} 读写一遍变成了 ${back}`);
  }
});

test('每一种都真的被认出来了，不是落到默认值', () => {
  for (const s of CANONICAL) {
    if (s === '每天 09:00') continue; // 它本身就是默认值，验不出
    assert.notEqual(writeWhen(readWhen(s)), '每天 09:00', `${s} 掉进了 DEFAULT_WHEN`);
  }
});

test('认不出的写法回落到默认值——这是刻意的，但只该发生在真认不出的时候', () => {
  assert.equal(writeWhen(readWhen('每月 1 号 09:00')), '每天 09:00');
  assert.equal(writeWhen(readWhen('')), '每天 09:00');
});

test('点位型落在格子上，常驻型不进格子', () => {
  assert.deepEqual(cadence('每天 09:00'), { kind: 'daily', h: 9, m: 0 });
  assert.equal(cadence('每周天 09:00')?.kind, 'weekly');
  assert.deepEqual(cadence('每周天 09:00'), cadence('每周日 09:00'));
  assert.equal(cadence('每 30 分钟')?.kind, 'interval');
  assert.equal(cadence('每 2 小时')?.kind, 'interval');
  assert.equal(cadence('每月 1 号'), undefined);
});
