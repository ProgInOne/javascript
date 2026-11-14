import { createFileRoute } from '@tanstack/react-router';
import { AiSettings } from '../../features/ai/AiSettings.tsx';

export const Route = createFileRoute('/settings/ai')({
  component: AiSettings,
});
