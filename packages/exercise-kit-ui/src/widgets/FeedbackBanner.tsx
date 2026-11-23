import {
  FeedbackBanner as CommonFeedbackBanner,
  type CheckLabels,
  type FeedbackBannerProps,
} from '@proginone/exercise-ui';
import { checkFailReasonLabel } from './CheckList.tsx';
import { CHECK_KIND_LABELS, isCheckKind } from './describe-check.ts';

/** Labels of this repository's check language (check kinds and failure reasons). */
export const JS_CHECK_LABELS: CheckLabels = {
  kind: (kind) => (isCheckKind(kind) ? CHECK_KIND_LABELS[kind] : undefined),
  reason: checkFailReasonLabel,
};

/** The common feedback banner with this repository's check labels. */
export function FeedbackBanner(props: FeedbackBannerProps) {
  return <CommonFeedbackBanner checkLabels={JS_CHECK_LABELS} {...props} />;
}
