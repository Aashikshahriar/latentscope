import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { useDatasetStore } from '@/stores/datasetStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { router } from './router';

export function App() {
  useEffect(() => {
    void useExperimentStore.getState().load();
    void useDatasetStore.getState().refreshLibrary();
  }, []);
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
}
