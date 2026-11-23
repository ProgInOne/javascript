import type {
  FixBugPublicSpec,
  ImplementFunctionPublicSpec,
  WebTaskPublicSpec,
} from '@proginone/exercise-kit';
import { Bug } from 'lucide-react';
import type { ReactNode } from 'react';
import { PreviewFrame, type PreviewFrameProps } from '../preview/PreviewFrame.tsx';
import { CodeWorkspace, type CodeRendererProps } from './CodeWorkspace.tsx';

export type ImplementFunctionProps = CodeRendererProps<ImplementFunctionPublicSpec>;

/**
 * `implement_function` (content-and-exercises.md#implement_function-함수-구현): editor with the
 * starter code, test list (visible tests show input/expected, hidden ones their description) and
 * console. 초기화 restores the starter code.
 */
export function ImplementFunction({ spec, ...props }: ImplementFunctionProps) {
  return (
    <CodeWorkspace
      {...props}
      starterFiles={spec.starter.files}
      checks={spec.checks}
      entry={spec.entry}
      timeoutMs={props.timeoutMs ?? spec.limits?.timeoutMs ?? 3000}
    />
  );
}

export type FixBugProps = CodeRendererProps<FixBugPublicSpec>;

/**
 * `fix_bug` (content-and-exercises.md#fix_bug-버그-수정): the symptom above the buggy code, same
 * workspace as `implement_function`. 초기화 restores the buggy code.
 */
export function FixBug({ spec, ...props }: FixBugProps) {
  return (
    <CodeWorkspace
      {...props}
      starterFiles={spec.buggy.files}
      checks={spec.checks}
      entry={spec.entry}
      timeoutMs={props.timeoutMs ?? spec.limits?.timeoutMs ?? 3000}
      intro={
        <div className="pi-ex-symptom">
          <Bug size={16} aria-hidden="true" />
          <div>
            <p className="pi-ex-symptom__title">증상</p>
            <p>{spec.bugDescription}</p>
            {spec.maxEditDistance !== undefined && (
              <p className="pi-ex-symptom__note">
                코드를 새로 쓰지 말고 버그가 있는 부분만 고쳐 보세요.
              </p>
            )}
          </div>
        </div>
      }
    />
  );
}

export interface WebTaskProps extends CodeRendererProps<WebTaskPublicSpec> {
  /** Preview container props: packages/runner mounts the sandboxed document via `mountRef`. */
  preview?: Omit<PreviewFrameProps, 'label'>;
}

/**
 * `web_task` basic form (content-and-exercises.md#web_task-웹-실습): editor | preview, with the
 * requirement checklist filled on each run. `focus: dom` opens the console first; milestones group
 * the checklist.
 */
export function WebTask({ spec, preview, ...props }: WebTaskProps): ReactNode {
  return (
    <CodeWorkspace
      {...props}
      starterFiles={spec.starter.files}
      checks={spec.checks}
      milestones={spec.milestones}
      layout="web"
      checksTitle="요구사항"
      defaultResultTab={spec.focus === 'dom' ? 'console' : 'tests'}
      preview={<PreviewFrame {...preview} />}
    />
  );
}
