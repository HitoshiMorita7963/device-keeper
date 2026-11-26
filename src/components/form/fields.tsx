"use client";

import type { ReactNode } from "react";
import { Controller, useFormContext, type FieldValues, type Path } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type BaseProps<T extends FieldValues> = {
  name: Path<T>;
  label: string;
  required?: boolean;
  description?: ReactNode;
  className?: string;
};

function Label({ htmlFor, label, required }: { htmlFor: string; label: string; required?: boolean }) {
  return (
    <FieldLabel htmlFor={htmlFor}>
      {label}
      {required ? (
        <span className="text-xs font-normal text-destructive" aria-hidden>
          必須
        </span>
      ) : null}
    </FieldLabel>
  );
}

function useFieldError<T extends FieldValues>(name: Path<T>) {
  const { getFieldState, formState } = useFormContext<T>();
  return getFieldState(name, formState).error;
}

export function TextField<T extends FieldValues>({
  name,
  label,
  required,
  description,
  className,
  type = "text",
  ...inputProps
}: BaseProps<T> & Omit<React.ComponentProps<typeof Input>, "name">) {
  const { register } = useFormContext<T>();
  const error = useFieldError<T>(name);
  const id = `f-${name}`;
  return (
    <Field data-invalid={!!error} className={className}>
      <Label htmlFor={id} label={label} required={required} />
      <Input id={id} type={type} aria-invalid={!!error} aria-required={required} {...inputProps} {...register(name)} />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={[error]} />
    </Field>
  );
}

export function TextareaField<T extends FieldValues>({ name, label, required, description, className }: BaseProps<T>) {
  const { register } = useFormContext<T>();
  const error = useFieldError<T>(name);
  const id = `f-${name}`;
  return (
    <Field data-invalid={!!error} className={className}>
      <Label htmlFor={id} label={label} required={required} />
      <Textarea id={id} rows={3} aria-invalid={!!error} {...register(name)} />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={[error]} />
    </Field>
  );
}

export type Option = { value: string | number; label: string };

export function SelectField<T extends FieldValues>({
  name,
  label,
  required,
  description,
  className,
  options,
  placeholder = "選択してください",
  disabled,
}: BaseProps<T> & { options: Option[]; placeholder?: string | false; disabled?: boolean }) {
  const { register } = useFormContext<T>();
  const error = useFieldError<T>(name);
  const id = `f-${name}`;
  return (
    <Field data-invalid={!!error} className={className}>
      <Label htmlFor={id} label={label} required={required} />
      <NativeSelect id={id} className="w-full" aria-invalid={!!error} disabled={disabled} {...register(name)}>
        {placeholder !== false ? <NativeSelectOption value="">{placeholder}</NativeSelectOption> : null}
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={String(o.value)}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={[error]} />
    </Field>
  );
}

export function CheckboxField<T extends FieldValues>({ name, label, description, className }: BaseProps<T>) {
  const { control } = useFormContext<T>();
  const id = `f-${name}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field orientation="horizontal" data-invalid={!!fieldState.error} className={className}>
          <Checkbox id={id} checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} onBlur={field.onBlur} />
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor={id} className="font-normal">
              {label}
            </FieldLabel>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            <FieldError errors={[fieldState.error]} />
          </div>
        </Field>
      )}
    />
  );
}
