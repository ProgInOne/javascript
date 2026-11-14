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
