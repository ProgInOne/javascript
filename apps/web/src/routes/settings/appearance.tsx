import { THEMES, type Settings } from '@proginone/shared';
import { ErrorState, RadioGroup, Skeleton, useToast } from '@proginone/ui';
import { createFileRoute } from '@tanstack/react-router';
import { useSettings, useUpdateSettings } from '../../api/queries.ts';

export const Route = createFileRoute('/settings/appearance')({
  component: AppearanceSettings,
});

const THEME_LABELS: Record<Settings['theme'], { label: string; description: string }> = {
  light: { label: '라이트', description: '밝은 화면' },
  dark: { label: '다크', description: '어두운 화면' },
  system: { label: '시스템', description: '운영체제 설정을 따라요' },
};

function AppearanceSettings() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const toast = useToast();

  return (
    <section aria-labelledby="appearance-title" className="settings-section">
      <h1 id="appearance-title" className="page-title">
        화면
      </h1>
      <div className="card">
        {settings.isPending ? (
          <Skeleton height={96} />
        ) : settings.isError ? (
          <ErrorState
            variant="inline"
            title="설정을 불러오지 못했어요"
            description={settings.error.message}
          />
        ) : (
          <RadioGroup
            legend="테마"
            value={settings.data.theme}
            disabled={update.isPending}
            options={THEMES.map((t) => ({ value: t, ...THEME_LABELS[t] }))}
            onValueChange={(value) => {
              update.mutate(
                { theme: value as Settings['theme'] },
                {
                  onError: (e) => {
                    toast({
                      title: '테마를 저장하지 못했어요',
                      description: e.message,
                      variant: 'error',
                    });
                  },
                },
              );
            }}
          />
        )}
      </div>
    </section>
  );
}
