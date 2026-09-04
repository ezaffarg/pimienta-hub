import { useRegisterActions } from 'kbar';
import { useTheme } from 'next-themes';
import { useThemeConfig } from '@/components/themes/active-theme';
import { THEMES } from '@/components/themes/theme.config';
import { useTranslations } from 'next-intl';

const useThemeSwitching = () => {
  const { theme, setTheme } = useTheme();
  const { activeTheme, setActiveTheme } = useThemeConfig();
  const translate = useTranslations('shell.theme');

  const toggleDarkLight = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const cycleTheme = () => {
    const currentIndex = THEMES.findIndex((t) => t.value === activeTheme);
    const nextIndex = (currentIndex + 1) % THEMES.length;
    setActiveTheme(THEMES[nextIndex].value);
  };

  const themeActions = [
    {
      id: 'cycleTheme',
      name: translate('switch'),
      shortcut: ['t', 't'],
      section: translate('label'),
      perform: cycleTheme
    },
    {
      id: 'toggleDarkLight',
      name: translate('toggleColorMode'),
      shortcut: ['d', 'd'],
      section: translate('label'),
      perform: toggleDarkLight
    },
    {
      id: 'setLightTheme',
      name: translate('setLight'),
      section: translate('label'),
      perform: () => setTheme('light')
    },
    {
      id: 'setDarkTheme',
      name: translate('setDark'),
      section: translate('label'),
      perform: () => setTheme('dark')
    }
  ];

  useRegisterActions(themeActions, [theme, activeTheme]);
};

export default useThemeSwitching;
