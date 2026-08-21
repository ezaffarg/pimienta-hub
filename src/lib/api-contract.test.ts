import { describe, expect, it } from 'vitest';
import { apiErrorResponse } from './api-errors';
import {
  productInputSchema,
  productListQuerySchema,
  resourceIdSchema,
  userInputSchema
} from './api-validation';

const validProduct = {
  name: 'Validated product',
  description: 'Deterministic validation fixture',
  price: 10,
  category: 'Security'
};

const validUser = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.test',
  phone: '111',
  status: 'Active'
};

describe('API validation and error contract', () => {
  it('accepts valid current product and user inputs', () => {
    expect(productInputSchema.safeParse(validProduct).success).toBe(true);
    expect(userInputSchema.safeParse(validUser).success).toBe(true);
  });

  it('rejects invalid request bodies with the validation schema', () => {
    expect(productInputSchema.safeParse({ ...validProduct, price: -1 }).success).toBe(false);
    expect(userInputSchema.safeParse({ ...validUser, email: 'invalid' }).success).toBe(false);
  });

  it('rejects client-supplied tenant and authorization fields', () => {
    expect(
      productInputSchema.safeParse({
        ...validProduct,
        organizationId: 'org_demo_b'
      }).success
    ).toBe(false);
    expect(
      userInputSchema.safeParse({
        ...validUser,
        role: 'Owner',
        permissions: ['users.write']
      }).success
    ).toBe(false);
  });

  it('accepts only unambiguous positive resource IDs', () => {
    expect(resourceIdSchema.safeParse('42')).toMatchObject({ success: true, data: 42 });
    expect(resourceIdSchema.safeParse('0').success).toBe(false);
    expect(resourceIdSchema.safeParse('4.2').success).toBe(false);
    expect(resourceIdSchema.safeParse('abc').success).toBe(false);
  });

  it('rejects invalid query values', () => {
    expect(productListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ sort: 'not-json' }).success).toBe(false);
    expect(
      productListQuerySchema.safeParse({ sort: '[{"id":"unknown","desc":false}]' }).success
    ).toBe(false);
    expect(productListQuerySchema.safeParse({ organizationId: 'org_demo_b' }).success).toBe(false);
  });

  it('returns stable validation and not-found error contracts', async () => {
    const validation = apiErrorResponse('VALIDATION_ERROR', 400);
    const notFound = apiErrorResponse('NOT_FOUND', 404);

    expect(validation.status).toBe(400);
    await expect(validation.json()).resolves.toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' }
    });
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' }
    });
  });
});
