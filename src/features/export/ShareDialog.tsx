import { Check, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { TextInput } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Overlay';
import type { Dataset } from '@/types/dataset';
import type { Experiment } from '@/types/experiment';
import { buildShareConfig, shareUrl } from '@/services/experiments/share';

export function ShareDialog({
  open,
  onOpenChange,
  dataset,
  experiment,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dataset: Dataset | null;
  experiment: Experiment | null;
}) {
  const [copied, setCopied] = useState(false);
  const url = useMemo(
    () => (open && dataset && experiment ? shareUrl(buildShareConfig(dataset, experiment)) : ''),
    [open, dataset, experiment],
  );
  const isDemo = dataset?.source.type === 'demo';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Share configuration"
      description="A link that reproduces this projection’s configuration. It contains settings only — never observation values."
    >
      {dataset && experiment && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <TextInput
              readOnly
              value={url}
              aria-label="Shareable link"
              onFocus={(e) => e.target.select()}
              className="num text-xs"
            />
            <Button
              variant="primary"
              icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              onClick={() =>
                void navigator.clipboard?.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {isDemo ? (
            <Callout tone="success" title="Fully reproducible">
              This is a built-in demonstration dataset, so the recipient’s browser regenerates the same data
              and re-runs the same seeded computation.
            </Callout>
          ) : (
            <Callout tone="warning" title="The recipient must load the same dataset">
              Your file is not part of the link. The link identifies it by name and SHA-256 checksum (
              {dataset.checksum.slice(0, 16)}…); once the recipient imports an identical file, the
              configuration is applied and the projection recomputed.
            </Callout>
          )}
          <p className="text-2xs leading-relaxed text-subtle">
            t-SNE and UMAP results are reproducible for the same seed, dataset and LatentScope version.
            Different software versions or browsers may produce small numerical differences.
          </p>
        </div>
      )}
    </Dialog>
  );
}
