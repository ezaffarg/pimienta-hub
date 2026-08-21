import { z } from 'zod';

function createSortSchema(allowedFields: readonly string[]) {
  return z
    .string()
    .max(1000)
    .refine(
      (value) => {
        try {
          const parsed: unknown = JSON.parse(value);

          return (
            Array.isArray(parsed) &&
            parsed.every(
              (item) =>
                typeof item === 'object' &&
                item !== null &&
                typeof item.id === 'string' &&
                allowedFields.includes(item.id) &&
                typeof item.desc === 'boolean'
            )
          );
        } catch {
          return false;
        }
      },
      { message: 'Invalid sort value' }
    );
}

const paginationSchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    search: z.string().max(200).optional()
  })
  .strict();

export const productListQuerySchema = paginationSchema.extend({
  categories: z.string().max(200).optional(),
  sort: createSortSchema(['id', 'name', 'description', 'price', 'category']).optional()
});

export const userListQuerySchema = paginationSchema.extend({
  roles: z.string().max(200).optional(),
  sort: createSortSchema(['id', 'name', 'email', 'phone', 'status', 'role']).optional()
});

export const resourceIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number);

export const productInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000),
    price: z.number().finite().nonnegative(),
    category: z.string().trim().min(1).max(100)
  })
  .strict();

export const userInputSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    email: z.string().email().max(320),
    phone: z.string().trim().min(1).max(50),
    status: z.enum(['Active', 'Inactive', 'Invited'])
  })
  .strict();

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
