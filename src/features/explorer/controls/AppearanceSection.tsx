import { Palette, RotateCcw } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { Select, Slider, Switch, TextInput } from '@/components/ui/Form';
import { Section } from '@/components/ui/Overlay';
import { useViewStore, type BackgroundMode, type LegendPosition } from '@/stores/viewStore';
import {
  CATEGORICAL_PALETTES,
  SEQUENTIAL_PALETTES,
  sequentialGradientCss,
  type CategoricalPaletteId,
  type SequentialPaletteId,
} from '@/visualization/common/palettes';

export function AppearanceSection() {
  const visuals = useViewStore((s) => s.visuals);
  const set = useViewStore((s) => s.setVisuals);
  return (
    <Section
      title="Appearance"
      icon={<Palette />}
      defaultOpen={false}
      aside={
        <IconButton
          size="sm"
          label="Reset appearance"
          icon={<RotateCcw />}
          onClick={() => useViewStore.getState().resetVisuals()}
        />
      }
    >
      <Slider
        label="Point size"
        value={visuals.pointSize}
        min={1}
        max={20}
        step={0.5}
        onChange={(v) => set({ pointSize: v })}
        format={(v) => `${v}px`}
      />
      <Slider
        label="Opacity"
        value={visuals.opacity}
        min={0.05}
        max={1}
        step={0.05}
        onChange={(v) => set({ opacity: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Select
        label="Categorical palette"
        value={visuals.categoricalPalette}
        onChange={(v) => set({ categoricalPalette: v as CategoricalPaletteId })}
        options={CATEGORICAL_PALETTES.map((p) => ({
          value: p.id,
          label: (
            <span className="flex items-center gap-2">
              <span className="flex">
                {p.colors.slice(0, 8).map((c) => (
                  <span
                    key={c}
                    className="size-2.5 first:rounded-l-sm last:rounded-r-sm"
                    style={{ background: c }}
                  />
                ))}
              </span>
              {p.name}
              {p.colorblindSafe && <span className="text-2xs text-teal">colour-blind safe</span>}
            </span>
          ),
        }))}
      />
      <Select
        label="Numeric colour map"
        value={visuals.sequentialPalette}
        onChange={(v) => set({ sequentialPalette: v as SequentialPaletteId })}
        options={(Object.keys(SEQUENTIAL_PALETTES) as SequentialPaletteId[]).map((id) => ({
          value: id,
          label: (
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-14 rounded-sm" style={{ background: sequentialGradientCss(id) }} />
              {SEQUENTIAL_PALETTES[id].name}
            </span>
          ),
        }))}
      />
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Select
          label="Background"
          value={visuals.background}
          onChange={(v) => set({ background: v as BackgroundMode })}
          options={[
            { value: 'theme', label: 'Theme' },
            { value: 'black', label: 'Black' },
            { value: 'white', label: 'White' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {visuals.background === 'custom' && (
          <TextInput
            type="color"
            aria-label="Custom background colour"
            value={visuals.customBackground}
            onChange={(e) => set({ customBackground: e.target.value })}
            className="h-8 w-12 cursor-pointer p-0.5"
          />
        )}
      </div>
      <Select
        label="Legend"
        value={visuals.legendPosition}
        onChange={(v) => set({ legendPosition: v as LegendPosition })}
        options={[
          { value: 'top-right', label: 'Top right' },
          { value: 'top-left', label: 'Top left' },
          { value: 'bottom-right', label: 'Bottom right' },
          { value: 'bottom-left', label: 'Bottom left' },
          { value: 'hidden', label: 'Hidden' },
        ]}
      />
      <div className="space-y-1">
        <Switch label="Axes" checked={visuals.showAxes} onChange={(v) => set({ showAxes: v })} />
        <Switch label="Grid" checked={visuals.showGrid} onChange={(v) => set({ showGrid: v })} />
        <Switch
          label="Labels for selected points"
          checked={visuals.showLabels}
          onChange={(v) => set({ showLabels: v })}
        />
        <Switch
          label="Dim unselected points"
          checked={visuals.dimUnselected}
          onChange={(v) => set({ dimUnselected: v })}
        />
        <Switch
          label="Shape encoding"
          hint="Draw each category with a distinct marker shape (circle, square, triangle, diamond, cross, ring) so classes are distinguishable without colour."
          checked={visuals.shapeEncoding}
          onChange={(v) => set({ shapeEncoding: v })}
        />
      </div>
    </Section>
  );
}
