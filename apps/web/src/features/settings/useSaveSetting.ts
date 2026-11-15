import type { SettingsPatch } from '@proginone/shared';
import { useToast } from '@proginone/ui';
import { useUpdateSettings } from '../../api/queries.ts';

/** Saves one settings change at once (no save button) and reports a failure as a toast. */
export function useSaveSetting() {
  const update = useUpdateSettings();
  const toast = useToast();
  const save = (patch: SettingsPatch, what: string) => {
    update.mutate(patch, {
      onError: (e) => {
        toast({
          title: `${what} 설정을 저장하지 못했어요`,
          description: e.message,
          variant: 'error',
        });
      },
    });
  };
  return { save, pending: update.isPending };
}
