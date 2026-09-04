'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import type { NavigationKey } from '@/i18n/config';
import { buildBreadcrumbs } from '@/i18n/shell';

export function useBreadcrumbs(translate: (key: NavigationKey) => string) {
  const pathname = usePathname();

  const breadcrumbs = useMemo(() => buildBreadcrumbs(pathname, translate), [pathname, translate]);

  return breadcrumbs;
}
