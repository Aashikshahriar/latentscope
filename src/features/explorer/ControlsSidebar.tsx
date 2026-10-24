import { AlgorithmSection } from './controls/AlgorithmSection';
import { AppearanceSection } from './controls/AppearanceSection';
import { ClusteringSection } from './controls/ClusteringSection';
import { ColorFilterSection } from './controls/ColorFilterSection';
import { DatasetSection } from './controls/DatasetSection';

export function ControlsSidebar() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <DatasetSection />
      <AlgorithmSection />
      <ColorFilterSection />
      <AppearanceSection />
      <ClusteringSection />
    </div>
  );
}
