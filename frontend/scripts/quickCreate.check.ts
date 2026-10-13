// 运行：node scripts/quickCreate.check.ts
import assert from 'node:assert/strict';
import { parseQuickTask, activeTagQuery } from '../src/quickCreate.ts';

const cases: [string, string, string[]][] = [
  ['完成资源管理设计 #工作', '完成资源管理设计', ['工作']],
  ['完成资源管理设计 #工作 #架构', '完成资源管理设计', ['工作', '架构']],
  ['完成 #架构 资源管理设计', '完成 #架构 资源管理设计', []],
  ['完成设计 #工作 后续优化', '完成设计 #工作 后续优化', []],
  ['完成 #架构 资源管理设计 #工作', '完成 #架构 资源管理设计', ['工作']],
  ['研究 C# 接口 #技术', '研究 C# 接口', ['技术']],
  ['完成设计 #', '完成设计 #', []],
  ['#工作 #架构', '', ['工作', '架构']],
  ['  写 a  b #Go #go #GO ', '写 a  b', ['Go']],
  ['a #b#c', 'a #b#c', []],
];
for (const [input, title, tags] of cases) {
  assert.deepEqual(parseQuickTask(input), { title, tags }, input);
}
assert.deepEqual(activeTagQuery('任务 #ar'), { start: 3, query: 'ar' });
assert.deepEqual(activeTagQuery('任务 #'), { start: 3, query: '' });
assert.equal(activeTagQuery('C#'), null);
assert.equal(activeTagQuery('任务 #ar '), null);
console.log('quickCreate ok');
