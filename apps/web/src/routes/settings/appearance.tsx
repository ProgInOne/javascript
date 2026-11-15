import { LESSON_FONT_SIZES, THEMES, WORKBENCH_THEMES, type Settings } from '@proginone/shared';
import { ErrorState, RadioGroup, Skeleton } from '@proginone/ui';
import { createFileRoute } from '@tanstack/react-router';
import { useSettings } from '../../api/queries.ts';
import { cardClass, pageTitleClass } from '../../app/layout.ts';
import { useSaveSetting } from '../../features/settings/useSaveSetting.ts';

export const Route = createFileRoute('/settings/appearance')({
  component: AppearanceSettings,
});

const THEME_LABELS: Record<Settings['theme'], { label: string; description: string }> = {
  light: { label: '라이트', description: '밝은 화면' },
  dark: { label: '다크', description: '어두운 화면' },
  system: { label: '시스템', description: '운영체제 설정을 따라요' },
};

const SIZE_LABELS: Record<Settings['lesson.fontSize'], { label: string; description: string }> = {
  small: { label: '작게', description: '16px' },
  medium: { label: '보통', description: '17px (기본)' },
  large: { label: '크게', description: '19px' },
};

const WORKBENCH_LABELS: Record<
  Settings['appearance.workbench'],
  { label: string; description: string }
> = {
  light: { label: '밝게', description: '레슨 코드 블록과 같은 모습 (기본)' },
  dark: { label: '어둡게', description: '실습의 코드 에디터와 콘솔만 어둡게' },
};

/** 설정 > 화면 (ui-ux.md#설정): theme, lesson body size (16/17/19px), workbench theme (D-024). */
function AppearanceSettings() {
  const settings = useSettings();
  const { save, pending } = useSaveSetting();

  return (
    <section aria-labelledby="appearance-title" className="max-w-[760px]">
      <h1 id="appearance-title" className={pageTitleClass}>
        화면
      </h1>
      <div className={`${cardClass} grid gap-6`}>
        {settings.isPending ? (
          <Skeleton height={96} />
        ) : settings.isError ? (
          <ErrorState
            variant="inline"
            title="설정을 불러오지 못했어요"
            description={settings.error.message}
          />
        ) : (
          <>
            <RadioGroup
              legend="테마"
              value={settings.data.theme}
              disabled={pending}
              options={THEMES.map((t) => ({ value: t, ...THEME_LABELS[t] }))}
              onValueChange={(value) => {
                save({ theme: value as Settings['theme'] }, '테마');
              }}
            />
            <RadioGroup
              legend="레슨 본문 글자 크기"
              value={settings.data['lesson.fontSize']}
              disabled={pending}
              options={LESSON_FONT_SIZES.map((s) => ({ value: s, ...SIZE_LABELS[s] }))}
              onValueChange={(value) => {
                save({ 'lesson.fontSize': value as Settings['lesson.fontSize'] }, '글자 크기');
              }}
            />
            <RadioGroup
              legend="작업대 테마"
              value={settings.data['appearance.workbench']}
              disabled={pending}
              options={WORKBENCH_THEMES.map((w) => ({ value: w, ...WORKBENCH_LABELS[w] }))}
              onValueChange={(value) => {
                save(
                  { 'appearance.workbench': value as Settings['appearance.workbench'] },
                  '작업대 테마',
                );
              }}
            />
          </>
        )}
      </div>
    </section>
  );
}
