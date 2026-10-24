import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Segmented } from '@/components/ui/Form';
import { PcaTutorial } from './PcaTutorial';
import { TsneTutorial } from './TsneTutorial';
import { UmapTutorial } from './UmapTutorial';
import type { Level } from './TutorialShell';

const TOPICS = [
  { value: 'pca', label: 'PCA' },
  { value: 'tsne', label: 't-SNE' },
  { value: 'umap', label: 'UMAP' },
] as const;
type Topic = (typeof TOPICS)[number]['value'];

export default function LearnPage() {
  const { topic: param } = useParams();
  const navigate = useNavigate();
  const topic: Topic = TOPICS.some((t) => t.value === param) ? (param as Topic) : 'pca';
  const [level, setLevel] = useState<Level>(() => {
    try {
      return (localStorage.getItem('latentscope.learn.level') as Level | null) ?? 'beginner';
    } catch {
      return 'beginner';
    }
  });
  const changeLevel = (l: Level) => {
    setLevel(l);
    try {
      localStorage.setItem('latentscope.learn.level', l);
    } catch {
      // Storage may be unavailable (private mode); the choice still applies for this visit.
    }
  };
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <header className="flex flex-wrap items-end gap-4">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <GraduationCap className="size-5 text-accent" aria-hidden /> Inside the Mathematics
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Step through PCA, t-SNE and UMAP on small examples. Every picture is computed live by the same
              code that powers the Explorer.
            </p>
          </div>
          <div className="w-full sm:w-80">
            <Segmented
              ariaLabel="Explanation level"
              value={level}
              onChange={changeLevel}
              options={[
                { value: 'beginner', label: 'Beginner' },
                { value: 'intermediate', label: 'Intermediate' },
                { value: 'mathematical', label: 'Mathematical' },
              ]}
            />
          </div>
        </header>
        <Segmented
          ariaLabel="Algorithm"
          value={topic}
          onChange={(t) => navigate(`/learn/${t}`)}
          options={[...TOPICS]}
          className="max-w-sm"
        />
        {topic === 'pca' && <PcaTutorial key="pca" level={level} />}
        {topic === 'tsne' && <TsneTutorial key="tsne" level={level} />}
        {topic === 'umap' && <UmapTutorial key="umap" level={level} />}
      </div>
    </div>
  );
}
