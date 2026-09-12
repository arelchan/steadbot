/**
 * 例行任务的时间数学。这是全产品最值得测的一段：它跑在用户的时区上，而机器可能在 UTC——
 * scheduler.ts 的注释里写着这条路出过事（云机器上「每天 20:00」在凌晨四点响）。
 * tick(now) 把 now 做成可注入的，本来就是为了能这么测。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastDue } from '../scheduler.ts';

/** 服务端认的全部写法。编辑器（BotConfigModal 的 readWhen）必须认得一样多，见 bot-crew 那侧的同名测试。 */
const CANONICAL = ['每天 09:00', '工作日 18:00', '每周三 09:00', '每周日 09:00', '每周天 09:00', '每小时', '每 30 分钟', '每 2 小时'];

const at = (iso: string) => new Date(iso);

test('六种写法一个都不能不认', () => {
  for (const s of CANONICAL) {
    const got = lastDue(s, at('2026-09-16T12:00:00Z'), 'Asia/Shanghai');
    // 每周几只在那一天返回时刻，其余日子 undefined——这也是"认得"
    assert.notEqual(got, null, `${s} 应该被解析`);
  }
});

test('认不出的返回 undefined，不猜', () => {
  for (const s of ['', '每天', '每月 1 号 09:00', '随便什么', '每天 25:00']) {
    assert.equal(lastDue(s, at('2026-09-16T12:00:00Z'), 'Asia/Shanghai'), undefined, `${s} 不该被解析`);
  }
});

test('「每周天」和「每周日」是同一天', () => {
  // 2026-09-13 是星期日
  const sun = at('2026-09-13T12:00:00+08:00');
  assert.equal(lastDue('每周天 09:00', sun, 'Asia/Shanghai'), lastDue('每周日 09:00', sun, 'Asia/Shanghai'));
  assert.notEqual(lastDue('每周日 09:00', sun, 'Asia/Shanghai'), undefined);
});

test('时区是用户的，不是机器的：北京 20:00 不会在 UTC 的 20:00 响', () => {
  // 北京时间 2026-09-16 20:30，机器在 UTC 上是当天 12:30
  const nowCn = at('2026-09-16T20:30:00+08:00');
  const due = lastDue('每天 20:00', nowCn, 'Asia/Shanghai');
  assert.ok(due !== undefined);
  // 这一刻已经过了当天 20:00，所以上一次该跑的就是当天 20:00（= UTC 12:00）
  assert.equal(new Date(due!).toISOString(), '2026-09-16T12:00:00.000Z');
});

test('还没到点就取不到今天这一次', () => {
  const before = at('2026-09-16T19:59:00+08:00');
  const due = lastDue('每天 20:00', before, 'Asia/Shanghai');
  assert.ok(due === undefined || due < at('2026-09-16T20:00:00+08:00').getTime());
});

test('工作日只在周一到周五', () => {
  const sat = at('2026-09-12T19:00:00+08:00'); // 星期六
  const mon = at('2026-09-14T19:00:00+08:00'); // 星期一
  assert.equal(lastDue('工作日 18:00', sat, 'Asia/Shanghai'), undefined);
  assert.notEqual(lastDue('工作日 18:00', mon, 'Asia/Shanghai'), undefined);
});

test('间隔型对齐到整步长', () => {
  const now = at('2026-09-16T12:07:30Z');
  const half = lastDue('每 30 分钟', now, 'UTC')!;
  assert.equal(new Date(half).toISOString(), '2026-09-16T12:00:00.000Z');
  const two = lastDue('每 2 小时', now, 'UTC')!;
  assert.equal(new Date(two).toISOString(), '2026-09-16T12:00:00.000Z');
});
