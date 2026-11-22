import AppTabs from '@/components/ui/app-tabs';
import { usePluginAppTabs } from '@/features/plugins';

export default function TabsLayout() {
  return <AppTabs extraTabs={usePluginAppTabs()} />;
}
