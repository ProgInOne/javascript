import { SETTINGS_DEFAULTS, type Settings } from '@proginone/shared';
import { IconButton, useToast } from '@proginone/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Moon, Sun } from 'lucide-react';
import { settingsQuery, useSettings, useUpdateSettings } from '../../api/queries.ts';
import { useMediaQuery } from '../../lib/panels.ts';
import { resolveTheme } from '../../lib/theme.ts';

const LABELS = {
  dark: '다크 테마로 바꾸기',
  light: '라이트 테마로 바꾸기',
} as const;

/**
 * Header light ↔ dark switch (D-078, ui-ux.md#전역-내비게이션). The next theme is the opposite
 * of the one on screen, so `system` resolves through the OS preference first. The change shows at
 * once (the settings cache is updated before the request, and ThemeSync applies it); a failed
 * save puts the previous theme back and says so in a toast.
 */
export function useThemeToggle() {
  const client = useQueryClient();
  const settings = useSettings();
  const update = useUpdateSettings();
  const toast = useToast();
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = settings.data?.theme ?? SETTINGS_DEFAULTS.theme;
  const next = resolveTheme(theme, systemDark) === 'dark' ? 'light' : 'dark';

  const toggle = () => {
    const previous = client.getQueryData<Settings>(settingsQuery.queryKey);
    if (!previous) return;
    client.setQueryData<Settings>(settingsQuery.queryKey, { ...previous, theme: next });
    update.mutate(
      { theme: next },
      {
        onError: (e) => {
          // Put the old theme back unless something newer has replaced ours meanwhile.
          const current = client.getQueryData<Settings>(settingsQuery.queryKey);
          if (current?.theme === next) {
            client.setQueryData<Settings>(settingsQuery.queryKey, {
              ...current,
              theme: previous.theme,
            });
          }
          toast({
            title: '테마를 바꾸지 못했어요',
            description: e.message,
            variant: 'error',
          });
        },
      },
    );
  };

  return {
    next,
    label: LABELS[next],
    icon: next === 'dark' ? Moon : Sun,
    disabled: !settings.data,
    toggle,
  };
}

/** The icon button for the app header and the learning-screen header. */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { label, icon: Icon, disabled, toggle } = useThemeToggle();
  return (
    <IconButton
      label={label}
      icon={<Icon size={18} />}
      variant="ghost"
      disabled={disabled}
      className={className}
      onClick={toggle}
    />
  );
}

/** The same switch as a full-width row of the narrow-screen header menu. */
export function ThemeToggleMenuItem({ className }: { className: string }) {
  const { label, icon: Icon, disabled, toggle } = useThemeToggle();
  return (
    <button type="button" className={className} disabled={disabled} onClick={toggle}>
      <Icon size={18} aria-hidden="true" />
      {label}
    </button>
  );
}
