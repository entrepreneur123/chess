/**
 * Top-level navigation model: the screens reachable from the persistent bottom tab bar.
 * Pure data (no DOM) so the router and tests share one definition.
 */
import type { IconName } from './icons';
import type { ScreenName } from './router';

export interface TabDef {
  name: ScreenName;
  label: string;
  icon: IconName;
  /** The raised centre tab (Battle). */
  main?: boolean;
}

/** Left to right. Battle (the lobby, the router's root) sits in the middle. */
export const TABS: readonly TabDef[] = [
  { name: 'collection', label: '캐릭터', icon: 'cards' },
  { name: 'lobby', label: '대전', icon: 'swords', main: true },
  { name: 'formation', label: '진형', icon: 'grid' },
];

export const TAB_SCREENS: readonly ScreenName[] = TABS.map((t) => t.name);

export function isTabScreen(name: ScreenName | null | undefined): boolean {
  return !!name && TAB_SCREENS.includes(name);
}
