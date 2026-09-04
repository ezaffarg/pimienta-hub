import type { Metadata } from 'next';
import type { NavGroup, NavItem } from '@/types';
import type { NavigationKey } from './config';

type NavigationTranslator = (key: NavigationKey) => string;
type MetadataTranslator = (key: 'description' | 'imageAlt') => string;

export function pickShellMessages<T extends { navigation: unknown; shell: unknown }>(
  messages: T
): Pick<T, 'navigation' | 'shell'> {
  return {
    navigation: messages.navigation,
    shell: messages.shell
  };
}

export type LocalizedNavItem = Omit<NavItem, 'items'> & {
  displayTitle: string;
  items?: LocalizedNavItem[];
};

export type LocalizedNavGroup = Omit<NavGroup, 'items'> & {
  displayLabel: string;
  items: LocalizedNavItem[];
};

function localizeNavItem(item: NavItem, translate: NavigationTranslator): LocalizedNavItem {
  return {
    ...item,
    displayTitle: item.labelKey ? translate(item.labelKey) : item.title,
    items: item.items?.map((child) => localizeNavItem(child, translate))
  };
}

export function localizeNavGroups(
  groups: NavGroup[],
  translate: NavigationTranslator
): LocalizedNavGroup[] {
  return groups.map((group) => ({
    ...group,
    displayLabel: group.labelKey ? translate(group.labelKey) : group.label,
    items: group.items.map((item) => localizeNavItem(item, translate))
  }));
}

const segmentKeys: Partial<Record<string, NavigationKey>> = {
  dashboard: 'dashboard',
  overview: 'overview',
  workspaces: 'workspaces',
  team: 'teams',
  product: 'product',
  users: 'users',
  kanban: 'kanban',
  chat: 'chat',
  'ai-chat': 'aiChat',
  forms: 'forms',
  basic: 'basicForm',
  'multi-step': 'multiStepForm',
  'sheet-form': 'sheetAndDialog',
  advanced: 'advancedPatterns',
  'react-query': 'reactQuery',
  elements: 'elements',
  icons: 'icons',
  exclusive: 'exclusive',
  profile: 'profile',
  notifications: 'notifications',
  billing: 'billing',
  integrations: 'integrations',
  'mercado-libre': 'mercadoLibre',
  'listing-sync-runs': 'listingSyncRuns'
};

export type BreadcrumbItem = { title: string; link: string };

export function buildBreadcrumbs(
  pathname: string,
  translate: NavigationTranslator
): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);

  return segments.map((segment, index) => {
    const key = segmentKeys[segment];
    return {
      title: key ? translate(key) : decodeURIComponent(segment),
      link: `/${segments.slice(0, index + 1).join('/')}`
    };
  });
}

export function buildRootMetadata(translate: MetadataTranslator, metadataBase?: URL): Metadata {
  return {
    ...(metadataBase ? { metadataBase } : {}),
    title: {
      default: 'Pimienta Hub',
      template: '%s | Pimienta Hub'
    },
    description: translate('description'),
    openGraph: {
      title: 'Pimienta Hub',
      description: translate('description'),
      siteName: 'Pimienta Hub',
      type: 'website',
      images: [
        {
          url: '/shadcn-dashboard.png',
          width: 3200,
          height: 1600,
          alt: translate('imageAlt')
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Pimienta Hub',
      description: translate('description'),
      images: ['/shadcn-dashboard.png']
    }
  };
}
