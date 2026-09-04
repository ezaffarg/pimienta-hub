'use client';
import { navGroups } from '@/config/nav-config';
import { KBarAnimator, KBarPortal, KBarPositioner, KBarProvider, KBarSearch } from 'kbar';
import { Kbd } from '@/components/ui/kbd';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import RenderResults from './render-result';
import useThemeSwitching from './use-theme-switching';
import { useFilteredNavGroups } from '@/hooks/use-nav';
import { localizeNavGroups } from '@/i18n/shell';
import { useTranslations } from 'next-intl';

export default function KBar({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const filteredGroups = useFilteredNavGroups(navGroups);
  const translateNavigation = useTranslations('navigation');
  const translateShell = useTranslations('shell');
  const localizedGroups = useMemo(
    () => localizeNavGroups(filteredGroups, translateNavigation),
    [filteredGroups, translateNavigation]
  );

  // These action are for the navigation
  const actions = useMemo(() => {
    // Define navigateTo inside the useMemo callback to avoid dependency array issues
    const navigateTo = (url: string) => {
      router.push(url);
    };

    const allItems = localizedGroups.flatMap((group) => group.items);

    return allItems.flatMap((navItem) => {
      // Only include base action if the navItem has a real URL and is not just a container
      const baseAction =
        navItem.url !== '#'
          ? {
              id: `${navItem.title.toLowerCase()}Action`,
              name: navItem.displayTitle,
              shortcut: navItem.shortcut,
              keywords: `${navItem.title} ${navItem.displayTitle}`.toLowerCase(),
              section: translateShell('search.navigationSection'),
              subtitle: translateShell('search.goTo', { destination: navItem.displayTitle }),
              perform: () => navigateTo(navItem.url)
            }
          : null;

      // Map child items into actions
      const childActions =
        navItem.items?.map((childItem) => ({
          id: `${childItem.title.toLowerCase()}Action`,
          name: childItem.displayTitle,
          shortcut: childItem.shortcut,
          keywords: `${childItem.title} ${childItem.displayTitle}`.toLowerCase(),
          section: navItem.displayTitle,
          subtitle: translateShell('search.goTo', { destination: childItem.displayTitle }),
          perform: () => navigateTo(childItem.url)
        })) ?? [];

      // Return only valid actions (ignoring null base actions for containers)
      return baseAction ? [baseAction, ...childActions] : childActions;
    });
  }, [router, localizedGroups, translateShell]);

  return (
    <KBarProvider actions={actions}>
      <KBarComponent>{children}</KBarComponent>
    </KBarProvider>
  );
}
const KBarComponent = ({ children }: { children: React.ReactNode }) => {
  useThemeSwitching();
  const translateShell = useTranslations('shell');

  return (
    <>
      <KBarPortal>
        <KBarPositioner className='bg-black/10 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 z-99999 flex items-start! justify-center p-4! pt-[14vh]!'>
          <KBarAnimator className='bg-popover text-popover-foreground ring-foreground/10 relative mx-auto w-full max-w-[600px] overflow-hidden rounded-xl shadow-lg ring-1'>
            <div className='bg-popover sticky top-0 z-10 border-b'>
              <KBarSearch
                placeholder={translateShell('search.placeholder')}
                className='placeholder:text-muted-foreground w-full border-none bg-transparent px-4 py-3.5 text-sm outline-hidden focus:ring-0 focus:outline-hidden'
              />
            </div>
            <div className='h-[400px]'>
              <RenderResults />
            </div>
            <div className='text-muted-foreground flex items-center gap-3 border-t px-3 py-2 text-xs'>
              <span className='flex items-center gap-1'>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> {translateShell('search.navigate')}
              </span>
              <span className='flex items-center gap-1'>
                <Kbd>↵</Kbd> {translateShell('search.open')}
              </span>
              <span className='flex items-center gap-1'>
                <Kbd>esc</Kbd> {translateShell('search.close')}
              </span>
            </div>
          </KBarAnimator>
        </KBarPositioner>
      </KBarPortal>
      {children}
    </>
  );
};
