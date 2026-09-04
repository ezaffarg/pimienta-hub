'use client';

import { useThemeConfig } from '@/components/themes/active-theme';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

import { Icons } from '../icons';
import { Kbd } from '@/components/ui/kbd';
import { THEMES } from './theme.config';
import { useTranslations } from 'next-intl';

export function ThemeSelector() {
  const { activeTheme, setActiveTheme } = useThemeConfig();
  const translate = useTranslations('shell.theme');

  return (
    <div className='flex items-center gap-2'>
      <Label htmlFor='theme-selector' className='sr-only'>
        {translate('label')}
      </Label>
      <Select
        items={THEMES.map((theme) => ({ value: theme.value, label: theme.name }))}
        value={activeTheme}
        onValueChange={(value) => {
          if (value !== null) setActiveTheme(value);
        }}
      >
        <SelectTrigger
          id='theme-selector'
          className='justify-start *:data-[slot=select-value]:w-24'
        >
          <span className='text-muted-foreground hidden sm:block'>
            <Icons.palette />
          </span>
          <span className='text-muted-foreground block sm:hidden'>{translate('label')}</span>
          <SelectValue placeholder={translate('select')} />
          <Kbd>T T</Kbd>
        </SelectTrigger>
        <SelectContent align='end'>
          {THEMES.length > 0 && (
            <>
              <SelectGroup>
                <SelectLabel>{translate('themes')}</SelectLabel>
                {THEMES.map((theme) => (
                  <SelectItem key={theme.name} value={theme.value}>
                    {theme.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
