# Forms Guide

This reference describes the current Pimienta Hub form composition retained from the
dashboard UI. It is a frontend pattern, not an auth or persistence boundary.

## Architecture

Forms use TanStack Form + Zod through:

- `src/lib/form.ts`: exports `useAppForm` and registers shared fields;
- `src/lib/form-context.ts`: shared field/form contexts;
- `src/components/forms/fields/`: field implementations;
- `src/components/forms/submit-button.tsx`: registered submit behavior;
- `src/components/ui/field.tsx`: shadcn field anatomy.

Import the hook from the canonical path:

```tsx
import { useAppForm } from '@/lib/form';
```

Do not use the removed `useFormFields<T>()` API and do not import forms from the
old `@/components/ui/tanstack-form` path.

## Standard form

```tsx
'use client';

const form = useAppForm({
  defaultValues: {
    name: '',
    status: ''
  } as OrderFormValues,
  validators: {
    onSubmit: orderSchema
  },
  onSubmit: async ({ value }) => {
    await mutation.mutateAsync(value);
  }
});

return (
  <form
    onSubmit={(event) => {
      event.preventDefault();
      form.handleSubmit();
    }}
  >
    <FieldGroup>
      <form.AppField
        name='name'
        children={(field) => (
          <field.TextField label='Name' required placeholder='Order name' />
        )}
      />

      <form.AppField
        name='status'
        children={(field) => (
          <field.SelectField
            label='Status'
            required
            options={STATUS_OPTIONS}
            placeholder='Select status'
          />
        )}
      />
    </FieldGroup>
  </form>
);
```

Key rules:

- Define the Zod schema and inferred values type in the feature schema.
- Put complete defaults in `useAppForm`.
- Validate the full payload with `validators.onSubmit`.
- Render registered fields through `form.AppField`.
- Prevent the native submit and call `form.handleSubmit()`.
- Keep mutation/UI callbacks in the client component.
- Server-side endpoints must validate and authorize again.

## Registered fields

The current registry in `src/lib/form.ts` includes:

- `TextField`
- `TextareaField`
- `SelectField`
- `CheckboxField`
- `SwitchField`
- `RadioGroupField`
- `SliderField`
- `ComboboxField`
- `DatePickerField`
- `DateRangeField`
- `OtpField`
- `ColorField`
- `FileUploadField`
- `CheckboxGroupField`
- `TagsField`
- `ToggleGroupField`

Inspect the component file under `src/components/forms/fields/` before using
props; do not infer a shared prop contract that the implementation does not
declare.

## Sheet and dialog forms

Use a native form `id` when its submit action lives in a footer outside the
form element:

```tsx
<form
  id='order-sheet-form'
  onSubmit={(event) => {
    event.preventDefault();
    form.handleSubmit();
  }}
>
  <form.AppField
    name='name'
    children={(field) => <field.TextField label='Name' required />}
  />
</form>

<SheetFooter>
  <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
    Cancel
  </Button>
  <Button type='submit' form='order-sheet-form'>
    Save
  </Button>
</SheetFooter>;
```

Close the sheet after a successful mutation, not merely after submit. Preserve
pending/error state and avoid duplicate submissions using the current shared
button pattern in the comparable feature.

## Custom fields

For a control not registered in `src/lib/form.ts`, use the raw TanStack field
render pattern and compose shared shadcn Field primitives. Extract a component
when the control needs local React state; do not call hooks conditionally or
inside a render callback.

Array fields use `mode='array'` only when supported by the actual component and
value type. Check existing checkbox-group, tags and toggle-group examples.

## Validation

- Client validation improves UX; it does not protect the server.
- Runtime server validation remains mandatory for body, params and query.
- Do not send Organization, role, Permission or Store Scope as trusted form
  authority.
- Do not surface raw provider, DB or auth errors in field messages.
- Map server failures to controlled user-facing messages.

## Current examples

Use these as implementation evidence before older snippets:

- `src/features/products/components/product-form.tsx`
- `src/features/users/components/user-form-sheet.tsx`
- `src/features/auth/components/user-auth-form.tsx`
- `src/components/forms/demo-form.tsx`

Demo forms illustrate field composition only. They do not establish productive
data access, tenancy or authorization.
