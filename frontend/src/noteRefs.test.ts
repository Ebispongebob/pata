import test from 'node:test';
import assert from 'node:assert';
import {
  resolveRef,
  pruneRefs,
  sameRefs,
  matchTrigger,
  filterNotes,
  relativePath,
  resolveHref,
  type NoteRef,
  type FileRef,
  filterCandidates,
  resolveFileHref,
  isVaultFileLink,
} from './noteRefsCore.ts';

test('resolveRef: 已绑定目标存在时成功解析', () => {
  const notes: NoteRef[] = [
    { id: 'n-1', title: 'Doris 部署', path: 'notes/doris.md' },
    { id: 'n-2', title: 'Doris 部署', path: 'notes/sub/doris.md' },
  ];
  const refs = { 'Doris 部署': 'n-1' };

  const res = resolveRef('Doris 部署', refs, notes);
  assert.strictEqual(res.note?.id, 'n-1');
  assert.strictEqual(res.reason, undefined);
});

test('resolveRef: 已绑定但目标 Note 已删除时，严禁新建同名 Note 接管旧绑定，必须保留失效提示', () => {
  // 原绑定目标为 n-old，该笔记已被删除
  const refs = { 'Doris 部署': 'n-old' };

  // 场景 1：库中无同名笔记
  const resEmpty = resolveRef('Doris 部署', refs, []);
  assert.strictEqual(resEmpty.note, undefined);
  assert.strictEqual(resEmpty.reason, '笔记不存在或已移动');

  // 场景 2：随后新建了同名笔记 n-new
  const notesAfterNew: NoteRef[] = [
    { id: 'n-new', title: 'Doris 部署', path: 'notes/new-doris.md' },
  ];
  const resHijack = resolveRef('Doris 部署', refs, notesAfterNew);
  // 必须依然失效，禁止自动接管！
  assert.strictEqual(resHijack.note, undefined);
  assert.strictEqual(resHijack.reason, '笔记不存在或已移动');

  // 场景 3：库中有多个同名笔记
  const notesMultiple: NoteRef[] = [
    { id: 'n-new-1', title: 'Doris 部署', path: 'notes/1.md' },
    { id: 'n-new-2', title: 'Doris 部署', path: 'notes/2.md' },
  ];
  const resMultiple = resolveRef('Doris 部署', refs, notesMultiple);
  assert.strictEqual(resMultiple.note, undefined);
  assert.strictEqual(resMultiple.reason, '笔记不存在或已移动');
});

test('resolveRef: 处理首尾空格与转义情况的绑定查询', () => {
  const notes: NoteRef[] = [
    { id: 'n-1', title: '架构设计', path: 'notes/arch.md' },
  ];
  // 引用文字带空格，但 refs key 是 trimmed
  const refs = { '架构设计': 'n-1' };
  const res1 = resolveRef(' 架构设计 ', refs, notes);
  assert.strictEqual(res1.note?.id, 'n-1');

  // 目标不存在
  const brokenRefs = { '架构设计': 'n-gone' };
  const resBroken = resolveRef(' 架构设计 ', brokenRefs, notes);
  assert.strictEqual(resBroken.note, undefined);
  assert.strictEqual(resBroken.reason, '笔记不存在或已移动');
});

test('resolveRef: 未绑定时仅在标题唯一匹配时解析', () => {
  const notes: NoteRef[] = [
    { id: 'n-unique', title: '唯一笔记', path: 'notes/u.md' },
    { id: 'n-dup-1', title: '重复笔记', path: 'notes/d1.md' },
    { id: 'n-dup-2', title: '重复笔记', path: 'notes/d2.md' },
  ];

  // 唯一匹配 -> 解析成功
  const res1 = resolveRef('唯一笔记', undefined, notes);
  assert.strictEqual(res1.note?.id, 'n-unique');

  // 重复笔记 -> 提示有多篇同名
  const resDup = resolveRef('重复笔记', undefined, notes);
  assert.strictEqual(resDup.note, undefined);
  assert.strictEqual(resDup.reason, '有多篇同名笔记，请编辑后重新选择');

  // 不存在 -> 提示笔记不存在或已移动
  const resNotFound = resolveRef('不存在', undefined, notes);
  assert.strictEqual(resNotFound.note, undefined);
  assert.strictEqual(resNotFound.reason, '笔记不存在或已移动');

  // 空字符串
  const resEmpty = resolveRef('   ', undefined, notes);
  assert.strictEqual(resEmpty.note, undefined);
  assert.strictEqual(resEmpty.reason, '笔记不存在或已移动');
});

test('pruneRefs: 只保留正文中实际出现且未转义的有效引用', () => {
  const text = '正文引用 [[笔记A]] 与 \\[[笔记B]]，已删除旧的 [[笔记C]]';
  const refs = {
    '笔记A': 'n-a',
    '笔记B': 'n-b',
    '笔记C': 'n-c',
    '笔记D': 'n-d',
  };

  const pruned = pruneRefs(text, refs);
  // 笔记B 被转义，不保留；笔记C 在正文中，保留；笔记D 不在正文中，被剔除
  assert.deepStrictEqual(pruned, {
    '笔记A': 'n-a',
    '笔记C': 'n-c',
  });
});

test('sameRefs: 比较引用映射一致性', () => {
  assert.strictEqual(sameRefs({ a: '1', b: '2' }, { b: '2', a: '1' }), true);
  assert.strictEqual(sameRefs({ a: '1' }, { a: '2' }), false);
  assert.strictEqual(sameRefs({ a: '1' }, { a: '1', b: '2' }), false);
});

test('matchTrigger: 触发与查询提取', () => {
  assert.deepStrictEqual(matchTrigger('hello [['), { start: 6, query: '' });
  assert.deepStrictEqual(matchTrigger('hello [[搜索词'), { start: 6, query: '搜索词' });
  assert.deepStrictEqual(matchTrigger('hello 【【中文输入'), { start: 6, query: '中文输入' });
  assert.strictEqual(matchTrigger('hello [[closed]]'), null);
});

test('filterNotes: 候选匹配', () => {
  const notes: NoteRef[] = [
    { id: '1', title: 'React 进阶', path: 'notes/react.md' },
    { id: '2', title: 'Vue 入门', path: 'notes/vue.md' },
    { id: '3', title: 'Reactive 编程', path: 'notes/reactive.md' },
  ];
  const matched = filterNotes(notes, 'react');
  assert.strictEqual(matched.length, 2);
  assert.strictEqual(matched[0].id, '1');
  assert.strictEqual(matched[1].id, '3');
});

test('relativePath & resolveHref: 路径解析', () => {
  assert.strictEqual(relativePath('notes/a.md', 'notes/b.md'), './b.md');
  assert.strictEqual(relativePath('notes/sub/a.md', 'notes/b.md'), '../b.md');

  const notes: NoteRef[] = [
    { id: '1', title: 'B', path: 'notes/b.md' },
  ];
  const res = resolveHref('notes/sub/a.md', '../b.md', notes);
  assert.strictEqual(res?.id, '1');

  const resMissing = resolveHref('notes/sub/a.md', '../non-exist.md', notes);
  assert.strictEqual(resMissing, undefined);

  // 外部链接返回 undefined
  assert.strictEqual(resolveHref('notes/a.md', 'https://example.com', notes), undefined);
});

test('filterCandidates: 同时混合 Note 与 File 候选并正确筛选', () => {
  const notes: NoteRef[] = [
    { id: '1', title: 'React 进阶', path: 'notes/react.md' },
    { id: '2', title: '周会纪要', path: 'notes/meeting.md' },
  ];
  const files: FileRef[] = [
    { name: 'react-flow.png', path: 'files/react-flow.png', ext: '.png', size: 1024, mod_time: '' },
    { name: 'spec.pdf', path: 'files/spec.pdf', ext: '.pdf', size: 2048, mod_time: '' },
  ];

  // 空 query -> 全部
  const all = filterCandidates(notes, files, '');
  assert.strictEqual(all.length, 4);

  // query 'react' -> 匹配 1 个 Note + 1 个 File
  const matched = filterCandidates(notes, files, 'react');
  assert.strictEqual(matched.length, 2);
  assert.strictEqual(matched[0].kind, 'note');
  if (matched[0].kind === 'note') {
    assert.strictEqual(matched[0].note.title, 'React 进阶');
  }
  assert.strictEqual(matched[1].kind, 'file');
  if (matched[1].kind === 'file') {
    assert.strictEqual(matched[1].file.name, 'react-flow.png');
  }
});

test('isVaultFileLink: 识别资源文件相对路径', () => {
  assert.strictEqual(isVaultFileLink('../files/spec.pdf'), true);
  assert.strictEqual(isVaultFileLink('files/image.png'), true);
  assert.strictEqual(isVaultFileLink('./files/doc.pdf'), true);
  assert.strictEqual(isVaultFileLink('../notes/b.md'), false);
  assert.strictEqual(isVaultFileLink('https://example.com/files/spec.pdf'), false);
});

test('resolveFileHref: 相对路径定位 Vault 文件资源', () => {
  const files: FileRef[] = [
    { name: 'spec.pdf', path: 'files/spec.pdf', ext: '.pdf', size: 2048, mod_time: '' },
  ];

  // 笔记中引用 ../files/spec.pdf
  const found = resolveFileHref('notes/a.md', '../files/spec.pdf', files);
  assert.strictEqual(found?.name, 'spec.pdf');

  // Today/Activity 中引用 ../files/spec.pdf
  const foundFromPlan = resolveFileHref('plans/2026-03-31.md', '../files/spec.pdf', files);
  assert.strictEqual(foundFromPlan?.name, 'spec.pdf');

  // 不存在的文件
  const notFound = resolveFileHref('notes/a.md', '../files/missing.pdf', files);
  assert.strictEqual(notFound, undefined);
});

