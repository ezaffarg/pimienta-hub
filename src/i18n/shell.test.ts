import { describe, expect, it } from 'vitest';
import { navGroups } from '@/config/nav-config';
import type { NavigationKey } from './config';
import type { NavGroup, NavItem } from '@/types';
import { loadMessages, mergeMessages } from './load-messages';
import { buildBreadcrumbs, buildRootMetadata, localizeNavGroups, pickShellMessages } from './shell';

function stableItemShape(item: NavItem): Record<string, unknown> {
  return {
    title: item.title,
    url: item.url,
    disabled: item.disabled,
    external: item.external,
    shortcut: item.shortcut,
    icon: item.icon,
    label: item.label,
    description: item.description,
    isActive: item.isActive,
    access: item.access,
    items: item.items?.map(stableItemShape)
  };
}

function stableNavigationShape(groups: NavGroup[]) {
  return groups.map((group) => ({
    label: group.label,
    items: group.items.map(stableItemShape)
  }));
}

describe('localized global shell', () => {
  it.each([
    ['en', 'Dashboard'],
    ['es-419', 'Panel'],
    ['pt-BR', 'Painel']
  ] as const)('renders navigation labels in %s', async (locale, expected) => {
    const messages = await loadMessages(locale);
    const groups = localizeNavGroups(navGroups, (key: NavigationKey) => messages.navigation[key]);

    expect(
      groups.flatMap((group) => group.items).find((item) => item.title === 'Dashboard')
        ?.displayTitle
    ).toBe(expected);
  });

  it('preserves stable navigation ids, hrefs and access metadata at the render boundary', async () => {
    const messages = await loadMessages('es-419');
    const localized = localizeNavGroups(
      navGroups,
      (key: NavigationKey) => messages.navigation[key]
    );

    expect(stableNavigationShape(localized)).toEqual(stableNavigationShape(navGroups));
    expect(
      localized.flatMap((group) => group.items).find((item) => item.title === 'Teams')?.access
    ).toEqual({ requireOrg: true });
  });

  it('translates known breadcrumb segments and leaves dynamic segments and links unchanged', async () => {
    const messages = await loadMessages('es-419');
    const breadcrumbs = buildBreadcrumbs(
      '/dashboard/integrations/mercado-libre/store-123',
      (key: NavigationKey) => messages.navigation[key]
    );

    expect(breadcrumbs.map((item) => item.title)).toEqual([
      'Panel',
      'Integraciones',
      'Mercado Libre',
      'store-123'
    ]);
    expect(breadcrumbs.at(-1)?.link).toBe('/dashboard/integrations/mercado-libre/store-123');
  });

  it.each([
    ['en', 'Search commands...'],
    ['es-419', 'Buscar comandos...'],
    ['pt-BR', 'Buscar comandos...']
  ] as const)('localizes command search in %s', async (locale, expected) => {
    expect((await loadMessages(locale)).shell.search.placeholder).toBe(expected);
  });

  it('builds localized root metadata without changing the product name', async () => {
    const messages = await loadMessages('pt-BR');
    const metadata = buildRootMetadata((key) => messages.shell.metadata[key]);

    expect(metadata.title).toEqual({ default: 'Pimienta Hub', template: '%s | Pimienta Hub' });
    expect(metadata.description).toContain('Plataforma operacional');
    expect(
      metadata.openGraph && 'images' in metadata.openGraph ? metadata.openGraph.images : null
    ).toEqual([expect.objectContaining({ alt: 'Visão geral do painel do Pimienta Hub' })]);
  });

  it('keeps English fallback values for a partial shell fixture', () => {
    const messages = mergeMessages(
      { shell: { search: { placeholder: 'Search commands...', noResults: 'No results found.' } } },
      { shell: { search: { placeholder: 'Buscar comandos...' } } }
    );

    expect(messages.shell.search).toEqual({
      placeholder: 'Buscar comandos...',
      noResults: 'No results found.'
    });
  });

  it('serializes only navigation and shell catalogs to the dashboard client boundary', async () => {
    const messages = await loadMessages('en');
    const scoped = pickShellMessages(messages);

    expect(Object.keys(scoped).toSorted()).toEqual(['navigation', 'shell']);
    expect(scoped).not.toHaveProperty('common');
  });
});
