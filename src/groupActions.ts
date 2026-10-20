import { t } from './i18n';
import type { Entry, TabGroupItem } from './types';

/** Shared group-level actions for search results and the member view. */
export function groupActions(group: TabGroupItem): Entry[] {
  const actions: Pick<Entry, 'action' | 'title' | 'keywords' | 'icon' | 'danger' | 'groupChanges'>[] = [
    { action: 'updateGroup', title: t(group.collapsed ? 'groupExpand' : 'groupCollapse'), keywords: group.collapsed ? 'expand open 展开' : 'collapse fold 折叠', icon: 'others', groupChanges: { collapsed: !group.collapsed } },
    { action: 'renameGroup', title: t('groupRename'), keywords: 'rename group 重命名 改名 名称', icon: 'settings' },
    { action: 'ungroupGroup', title: t('groupUngroup'), keywords: 'ungroup dissolve delete group keep tabs 解散 删除 分组 保留 标签页', icon: 'others', danger: true },
    { action: 'closeGroup', title: t('groupClose'), keywords: 'close entire group tabs 关闭 整个组 标签组', icon: 'close', danger: true },
  ];
  return actions.map(action => ({ ...action, id: `group:${group.id}:${action.action}`, kind: 'command', subtitle: group.title, groupId: group.id }));
}
