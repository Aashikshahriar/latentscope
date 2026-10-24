import { Select as RadixSelect, Slider as RadixSlider, Switch as RadixSwitch, ToggleGroup } from 'radix-ui';
import { Check, ChevronDown, Info } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { cn } from '@/utils/misc';
import { Tooltip } from './Tooltip';

export function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {children}
      </label>
      {hint && (
        <Tooltip content={hint}>
          <button type="button" className="text-subtle hover:text-fg" aria-label="More information">
            <Info className="size-3" aria-hidden />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  id,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} hint={hint}>
        {label}
      </FieldLabel>
      {children}
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  'h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-fg placeholder:text-subtle transition-colors hover:border-line-strong focus:border-accent/70 focus:outline-none aria-[invalid=true]:border-danger/70';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

/**
 * Numeric input that keeps a local draft and commits on blur / Enter, validating the range.
 * `allowNull` lets an empty field mean "automatic".
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  integer = false,
  hint,
  allowNull = false,
  nullLabel = 'auto',
  className,
}: {
  label: ReactNode;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  hint?: ReactNode;
  allowNull?: boolean;
  nullLabel?: string;
  className?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(value === null ? '' : String(value));
    setError(null);
  }, [value]);

  const commit = () => {
    const text = draft.trim();
    if (text === '' && allowNull) {
      setError(null);
      if (value !== null) onChange(null);
      return;
    }
    const v = Number(text);
    if (text === '' || !Number.isFinite(v)) return setError('Enter a number.');
    if (integer && !Number.isInteger(v)) return setError('Enter a whole number.');
    if (min !== undefined && v < min) return setError(`Minimum is ${min}.`);
    if (max !== undefined && v > max) return setError(`Maximum is ${max}.`);
    setError(null);
    if (v !== value) onChange(v);
  };

  return (
    <Field label={label} hint={hint} error={error} id={id} className={className}>
      <input
        id={id}
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        className={cn(inputClass, 'num')}
        value={draft}
        min={min}
        max={max}
        step={step}
        placeholder={allowNull ? nullLabel : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </Field>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: string;
  disabled?: boolean;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  hint,
  ariaLabel,
  className,
  placeholder,
}: {
  value: T | undefined;
  onChange: (v: T) => void;
  options: SelectOption<T>[];
  label?: ReactNode;
  hint?: ReactNode;
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
}) {
  const id = useId();
  const trigger = (
    <RadixSelect.Root value={value ?? ''} onValueChange={(v) => onChange(v as T)}>
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(inputClass, 'flex items-center justify-between gap-2 text-left', className)}
      >
        <span className="truncate">
          <RadixSelect.Value placeholder={placeholder ?? 'Select…'} />
        </span>
        <RadixSelect.Icon>
          <ChevronDown className="size-3.5 text-subtle" aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-elevated shadow-pop animate-fade-in"
        >
          <RadixSelect.Viewport className="scroll-thin p-1">
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-default select-none flex-col rounded-md py-1.5 pr-2 pl-7 text-sm text-fg outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent/15"
              >
                <RadixSelect.ItemIndicator className="absolute top-2 left-2">
                  <Check className="size-3.5 text-accent" aria-hidden />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                {o.description && <span className="text-xs text-subtle">{o.description}</span>}
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
  if (!label) return trigger;
  return (
    <Field label={label} hint={hint} id={id}>
      {trigger}
    </Field>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format = (v: number) => String(v),
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  hint?: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <FieldLabel hint={hint}>{label}</FieldLabel>
        <span className="num text-xs text-fg">{format(value)}</span>
      </div>
      <RadixSlider.Root
        className="relative flex h-4 w-full touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v!)}
      >
        <RadixSlider.Track className="relative h-1 grow rounded-full bg-line">
          <RadixSlider.Range className="absolute h-full rounded-full bg-accent" />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          aria-label={label}
          className="block size-3.5 rounded-full border-2 border-accent bg-canvas shadow transition-transform hover:scale-110"
        />
      </RadixSlider.Root>
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className={cn('text-sm text-fg/90', disabled && 'opacity-50')}>
          {label}
        </label>
        {hint && (
          <Tooltip content={hint}>
            <button type="button" className="text-subtle hover:text-fg" aria-label="More information">
              <Info className="size-3" aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="relative h-5 w-9 shrink-0 rounded-full border border-line bg-surface transition-colors data-[state=checked]:border-accent/60 data-[state=checked]:bg-accent/80 disabled:opacity-40"
      >
        <RadixSwitch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-fg shadow transition-transform data-[state=checked]:translate-x-[1.1rem]" />
      </RadixSwitch.Root>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  ariaLabel: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={ariaLabel}
      className={cn('inline-flex w-full rounded-lg border border-line bg-surface p-0.5', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          title={o.title}
          disabled={o.disabled}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium text-muted transition-colors hover:text-fg disabled:opacity-40',
            'data-[state=on]:bg-elevated data-[state=on]:text-fg data-[state=on]:shadow-[0_0_0_1px_var(--color-line-strong)]',
            size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-sm',
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2.5', disabled && 'opacity-50')}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line accent-[var(--color-accent)]"
      />
      <label htmlFor={id} className="cursor-pointer text-sm leading-snug text-fg/90">
        {label}
        {description && <span className="mt-0.5 block text-xs text-subtle">{description}</span>}
      </label>
    </div>
  );
}
