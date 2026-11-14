import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentPropsWithRef } from 'react';
import { cx } from './cx.ts';

/**
 * Tabs (Radix): roving focus with ←/→ (Home/End), automatic activation.
 * `underline` for content tabs, `pill` for switching inside a panel.
 */
export function Tabs({ className, ...rest }: ComponentPropsWithRef<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root {...rest} className={cx('pi-tabs', className)} />;
}

export interface TabsListProps extends ComponentPropsWithRef<typeof TabsPrimitive.List> {
  variant?: 'underline' | 'pill';
}

export function TabsList({ variant = 'underline', className, ...rest }: TabsListProps) {
  return (
    <TabsPrimitive.List
      {...rest}
      className={cx('pi-tabs__list', `pi-tabs__list--${variant}`, className)}
    />
  );
}

export function TabsTrigger({
  className,
  ...rest
}: ComponentPropsWithRef<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger {...rest} className={cx('pi-tabs__trigger', className)} />;
}

export function TabsContent({
  className,
  ...rest
}: ComponentPropsWithRef<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content {...rest} className={cx('pi-tabs__content', className)} />;
}
