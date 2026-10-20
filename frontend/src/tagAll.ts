/**
 * 判断是否为虚拟「全部」标签视图（选中的 tag 为空或仅含空白时代表全部）。
 */
export function isVirtualAllTag(tag?: string | null): boolean {
  return !tag || !tag.trim();
}

/**
 * 标签视图顶栏展示标题：全部视图显示「全部」，具体标签显示标签名。
 */
export function formatTagViewHeader(tag?: string | null): string {
  return isVirtualAllTag(tag) ? '全部' : tag!;
}

/**
 * 标签视图加载提示文案。
 */
export function formatTagLoadingText(tag?: string | null): string {
  return isVirtualAllTag(tag) ? '正在加载全部内容...' : `正在加载 #${tag} 关联内容...`;
}

/**
 * 标签视图错误提示主语。
 */
export function formatTagErrorSubject(tag?: string | null): string {
  return isVirtualAllTag(tag) ? '全部' : `标签 #${tag}`;
}

/**
 * 标签视图空状态提示文案。
 */
export function formatTagEmptyMessage(tag?: string | null): string {
  return isVirtualAllTag(tag)
    ? '工作空间暂无任务、笔记或记录'
    : `未找到包含标签 #${tag} 的任务、笔记或记录`;
}
