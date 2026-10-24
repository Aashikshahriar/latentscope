import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { NumberField } from '@/components/ui/Form';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { Legend } from '@/visualization/Legend';
import { MetricValueCell } from '@/features/metrics/MetricsPanel';
import { TutorialShell, type TutorialStep } from '@/features/education/TutorialShell';
import AboutPage from '@/features/about/AboutPage';
import { computeColorMapping } from '@/visualization/common/colorMapping';
import type { Dataset } from '@/types/dataset';

const dataset: Dataset = {
  id: 'd',
  name: 'd',
  source: { type: 'upload', fileName: 'x', format: 'csv' },
  n: 3,
  d: 1,
  values: Float32Array.from([1, 2, 3]),
  featureNames: ['f'],
  ids: ['a', 'b', 'c'],
  columns: [
    { name: 'species', role: 'label', kind: 'categorical', values: ['setosa', 'virginica', 'setosa'] },
  ],
  checksum: '0'.repeat(64),
  createdAt: '',
  importNotes: [],
};

describe('NumberField', () => {
  it('validates on commit and reports errors accessibly', async () => {
    const onChange = vi.fn();
    render(
      <TooltipProvider>
        <NumberField label="Perplexity" value={30} min={1} max={100} onChange={onChange} />
      </TooltipProvider>,
    );
    const input = screen.getByLabelText('Perplexity');
    await userEvent.clear(input);
    await userEvent.type(input, '500{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Maximum is 100.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(input);
    await userEvent.type(input, '42{Enter}');
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it('allows an empty value to mean automatic when permitted', async () => {
    const onChange = vi.fn();
    render(
      <TooltipProvider>
        <NumberField label="Learning rate" value={200} allowNull onChange={onChange} />
      </TooltipProvider>,
    );
    const input = screen.getByLabelText('Learning rate');
    await userEvent.clear(input);
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('Legend', () => {
  it('lists categories as toggle buttons with pressed state', async () => {
    const mapping = computeColorMapping(
      dataset,
      { type: 'column', name: 'species' },
      [],
      'okabe-ito',
      'viridis',
    );
    const onToggle = vi.fn();
    render(
      <Legend
        mapping={mapping}
        position="top-right"
        hidden={['virginica']}
        shapes={false}
        sequentialPalette="viridis"
        onToggle={onToggle}
      />,
    );
    const setosa = screen.getByRole('button', { name: /setosa/ });
    expect(setosa).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /virginica/ })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(setosa);
    expect(onToggle).toHaveBeenCalledWith('setosa');
  });
});

describe('MetricValueCell', () => {
  it('marks sampled values as approximate with their sample size', () => {
    render(
      <MetricValueCell
        value={{ value: 0.91234, approximate: true, sampleSize: 1000, population: 5000, seed: 0 }}
      />,
    );
    expect(screen.getByText('0.9123')).toBeInTheDocument();
    expect(screen.getByText(/sampled 1,000\/5,000/)).toBeInTheDocument();
  });
  it('marks exact values as exact', () => {
    render(
      <MetricValueCell
        value={{ value: 1, approximate: false, sampleSize: 10, population: 10, seed: null }}
      />,
    );
    expect(screen.getByText('exact')).toBeInTheDocument();
  });
});

describe('TutorialShell', () => {
  const steps: TutorialStep[] = [
    {
      title: 'One',
      text: { beginner: <p>simple</p>, intermediate: <p>more</p>, mathematical: <p>formal</p> },
      math: ['x^2'],
    },
    {
      title: 'Two',
      text: { beginner: <p>second</p>, intermediate: <p>second+</p>, mathematical: <p>second++</p> },
    },
  ];
  it('shows text for the chosen level and hides formulas for beginners', () => {
    const { rerender, container } = render(
      <TutorialShell steps={steps} step={0} setStep={() => {}} level="beginner" visual={null} />,
    );
    expect(screen.getByText('simple')).toBeInTheDocument();
    expect(container.querySelector('.katex')).toBeNull();
    rerender(<TutorialShell steps={steps} step={0} setStep={() => {}} level="mathematical" visual={null} />);
    expect(screen.getByText('formal')).toBeInTheDocument();
    expect(container.querySelector('.katex')).not.toBeNull();
  });
  it('navigates between steps', async () => {
    const setStep = vi.fn();
    render(<TutorialShell steps={steps} step={0} setStep={setStep} level="beginner" visual={null} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(setStep).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: '1. One' })).toHaveAttribute('aria-current', 'step');
  });
});

describe('AboutPage', () => {
  it('states the privacy model and licence', () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is uploaded/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Licence' })).toBeInTheDocument();
  });
});
