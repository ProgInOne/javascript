/**
 * Theme values for `<html data-theme>`. Omit the attribute to follow the OS preference.
 */
export type Theme = 'light' | 'dark';

/**
 * Values for `<html data-workbench>`. `dark` remaps `.workbench` subtrees (editor,
 * console) to dark colors while the rest of the page keeps its theme.
 */
export type WorkbenchTheme = 'light' | 'dark';

/** Class that marks a subtree as the practice workbench. */
export const WORKBENCH_CLASS = 'workbench';

export { Badge, type BadgeProps, type BadgeVariant } from './components/Badge.tsx';
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/Button.tsx';
export {
  Checkbox,
  RadioGroup,
  type CheckboxProps,
  type RadioGroupProps,
  type RadioOption,
} from './components/Checkbox.tsx';
export { Dialog, Drawer, type DialogProps, type DrawerProps } from './components/Dialog.tsx';
export { IconButton, type IconButtonProps } from './components/IconButton.tsx';
export { Input, type InputProps } from './components/Input.tsx';
export { Popover, type PopoverProps } from './components/Popover.tsx';
export {
  ProgressBar,
  ProgressRing,
  type ProgressBarProps,
  type ProgressRingProps,
} from './components/Progress.tsx';
export { Select, type SelectOption, type SelectProps } from './components/Select.tsx';
export { Skeleton, type SkeletonProps } from './components/Skeleton.tsx';
export { Spinner } from './components/Spinner.tsx';
export {
  EmptyState,
  ErrorState,
  type EmptyStateProps,
  type ErrorStateProps,
} from './components/States.tsx';
export {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type TabsListProps,
} from './components/Tabs.tsx';
export {
  ToastProvider,
  useToast,
  type ToastOptions,
  type ToastVariant,
} from './components/Toast.tsx';
export { Tooltip, TooltipProvider, type TooltipProps } from './components/Tooltip.tsx';
export { UiProvider } from './components/UiProvider.tsx';
