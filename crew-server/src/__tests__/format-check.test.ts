/**
 * 这段代码决定用户看不看得到一条消息（bots.ts 会把不过关的扣下来让模型重发），
 * 所以它误判的代价是"话没送到"。它全是纯函数，没有理由不测。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFormats } from '../format-check.ts';

const ok = (s: string) => assert.deepEqual(checkFormats(s), [], `不该有意见：${s.slice(0, 40)}`);
const bad = (s: string, why: string) => assert.ok(checkFormats(s).length > 0, `应该拦下（${why}）：${s.slice(0, 40)}`);

test('没有代码块就没有意见——常见情况要便宜', () => {
  ok('就是一句话');
  ok('带个网址 https://example.com 也没事');
  ok('行内 `code` 不是围栏');
});

test('围栏没闭合会把后面的正文全吞掉', () => {
  bad('```js\nconst a = 1\n后面这些都掉进代码块里了', '奇数个围栏');
  ok('```js\nconst a = 1\n```\n正文');
});

test('mermaid 的第一行必须是图类型', () => {
  ok('```mermaid\nflowchart TD\n  A --> B\n```');
  bad('```mermaid\nA --> B\n```', '没写图类型');
  bad('```mermaid\n```', '空块');
  bad('```mermaid\nflowchart TD\n```', '只有图类型没有节点');
});

test('括号引号不配对，渲染出来是个红框', () => {
  bad('```mermaid\nflowchart TD\n  A[云桌面 (Docker] --> B\n```', '方括号没配对');
  ok('```mermaid\nflowchart TD\n  A["云桌面 (Docker)"] --> B\n```');
  bad('```mermaid\nflowchart TD\n  A["没关引号] --> B\n```', '引号没成对');
});

test('已知缺口：配平但嵌套的标签它看不出来', () => {
  // A[云桌面 (Docker)] 在 mermaid 里其实会挂，但括号是配平的，计数规则看不出来。
  // 没补这条规则是故意的：这里误判的代价是"用户的话被扣住不发"，而合法的 A(圆角节点)、
  // A((圆)) 跟它没法靠正则可靠区分。提示词里已经让 bot 给这种标签加引号（identity.ts）。
  ok('```mermaid\nflowchart TD\n  A[云桌面 (Docker)] --> B\n```');
});

test('引号里的东西不算语法', () => {
  ok('```mermaid\nflowchart TD\n  A["a[b](c)"] --> B\n```');
});

test('箭头后面得有节点', () => {
  bad('```mermaid\nflowchart TD\n  A -->\n```', '箭头悬空');
});

test('json 块要真的是 json', () => {
  ok('```json\n{"a":1}\n```');
  bad('```json\n{a:1,}\n```', '解析不了');
  ok('```json\n```');
});

test('注释行不当第一行', () => {
  ok('```mermaid\n%% 说明\nflowchart TD\n  A --> B\n```');
});
