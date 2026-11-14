import type { MasteryStage } from '@proginone/shared';

/** Stage names from the glossary (ui-ux.md 마이크로카피 원칙 6). */
export const STAGE_NAMES: Readonly<Record<MasteryStage, string>> = {
  not_started: '미학습',
  introduced: '입문',
  practicing: '연습 중',
  proficient: '숙련',
  mastered: '숙달',
};

const WEDGE: Partial<Record<MasteryStage, string>> = {
  introduced: 'M8 8V1.5A6.5 6.5 0 0 1 14.5 8Z',
  practicing: 'M8 1.5A6.5 6.5 0 0 1 8 14.5Z',
  proficient: 'M8 8V1.5A6.5 6.5 0 1 1 1.5 8Z',
};

export interface MasteryIconProps {
  stage: MasteryStage;
  /** Amber outer ring + "복습 예정" (ui-ux.md 숙련 단계 스케일). */
  due?: boolean;
  /** Red dot top right + "약점" (a confirmed misconception). */
  weak?: boolean;
  size?: 16 | 20 | 24;
  /** Hide from assistive technology when the stage is said in text next to it. */
  decorative?: boolean;
  className?: string;
}

/** Accessible name of a stage with its markers: "숙련 단계: 연습 중, 복습 예정, 약점". */
export function masteryLabel(stage: MasteryStage, due = false, weak = false): string {
  return `숙련 단계: ${STAGE_NAMES[stage]}${due ? ', 복습 예정' : ''}${weak ? ', 약점' : ''}`;
}

/**
 * MasteryIcon (ui-ux.md 학습 특화 컴포넌트): one hue in five lightness steps plus a shape per
 * stage (◌ ◔ ◑ ◕ ●✓), so stages read without color and in grayscale.
 */
export function MasteryIcon({
  stage,
  due = false,
  weak = false,
  size = 16,
  decorative = false,
  className,
}: MasteryIconProps) {
  const label = masteryLabel(stage, due, weak);
  const wedge = WEDGE[stage];
  return (
    <svg
      className={`mastery-icon ${className ?? ''}`}
      data-stage={stage}
      width={size}
      height={size}
      viewBox="-2 -2 20 20"
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {stage === 'not_started' && <circle className="mastery-icon__ring" cx="8" cy="8" r="6.5" />}
      {stage === 'mastered' && (
        <>
          <circle className="mastery-icon__bg" cx="8" cy="8" r="7.25" />
          <path className="mastery-icon__check" d="M5 8.3l2.1 2.1L11.2 6" />
        </>
      )}
      {wedge && (
        <>
          <circle className="mastery-icon__bg" cx="8" cy="8" r="6.5" />
          <path className="mastery-icon__wedge" d={wedge} />
          <circle className="mastery-icon__ring" cx="8" cy="8" r="6.5" />
        </>
      )}
      {due && <circle className="mastery-icon__due" cx="8" cy="8" r="9.6" />}
      {weak && <circle className="mastery-icon__weak" cx="14" cy="2.2" r="2.6" />}
    </svg>
  );
}
