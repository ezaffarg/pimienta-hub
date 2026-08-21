////////////////////////////////////////////////////////////////////////////////
// 🛑 Nothing in here has anything to do with Nextjs, it's just a fake database
////////////////////////////////////////////////////////////////////////////////

import { faker } from '@faker-js/faker';
import { matchSorter } from 'match-sorter'; // For filtering
import { MOCK_ORGANIZATIONS } from './mock-tenants';

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Define the shape of Product data
export type Product = {
  organizationId: string;
  photo_url: string;
  name: string;
  description: string;
  created_at: string;
  price: number;
  id: number;
  category: string;
  updated_at: string;
};

function generateRandomProductData(id: number): Product {
  const categories = [
    'Electronics',
    'Furniture',
    'Clothing',
    'Toys',
    'Groceries',
    'Books',
    'Jewelry',
    'Beauty Products'
  ];

  return {
    organizationId: id % 2 === 0 ? MOCK_ORGANIZATIONS.orgB : MOCK_ORGANIZATIONS.orgA,
    id,
    name: faker.commerce.productName(),
    description: faker.commerce.productDescription(),
    created_at: faker.date.between({ from: '2022-01-01', to: '2023-12-31' }).toISOString(),
    price: parseFloat(faker.commerce.price({ min: 5, max: 500, dec: 2 })),
    photo_url: `https://api.slingacademy.com/public/sample-products/${id}.png`,
    category: faker.helpers.arrayElement(categories),
    updated_at: faker.date.recent().toISOString()
  };
}

// Mock product data store
export const fakeProducts = {
  records: [] as Product[], // Holds the list of product objects

  // Initialize with sample data
  initialize() {
    const sampleProducts: Product[] = [];
    // Generate remaining records
    for (let i = 1; i <= 20; i++) {
      sampleProducts.push(generateRandomProductData(i));
    }

    this.records = sampleProducts;
  },

  // Get all products with optional category filtering and search
  async getAll({
    organizationId,
    categories = [],
    search
  }: {
    organizationId?: string;
    categories?: string[];
    search?: string;
  }) {
    let products = organizationId
      ? this.records.filter((product) => product.organizationId === organizationId)
      : [];

    // Filter products based on selected categories
    if (categories.length > 0) {
      products = products.filter((product) => categories.includes(product.category));
    }

    // Search functionality across multiple fields
    if (search) {
      products = matchSorter(products, search, {
        keys: ['name', 'description', 'category']
      });
    }

    return products;
  },

  // Get paginated results with optional category filtering, search, and sorting
  async getProducts({
    organizationId,
    page = 1,
    limit = 10,
    categories,
    search,
    sort
  }: {
    organizationId?: string;
    page?: number;
    limit?: number;
    categories?: string | string[];
    search?: string;
    sort?: string;
  }) {
    await delay(1000);
    const categoriesArray = categories
      ? Array.isArray(categories)
        ? categories
        : String(categories).split(/[.,]/)
      : [];
    const allProducts = await this.getAll({
      organizationId,
      categories: categoriesArray,
      search
    });

    // Sorting
    if (sort) {
      try {
        const sortItems = JSON.parse(sort) as {
          id: string;
          desc: boolean;
        }[];
        if (sortItems.length > 0) {
          const { id, desc } = sortItems[0];
          allProducts.sort((a, b) => {
            const aVal = (a as Record<string, unknown>)[id];
            const bVal = (b as Record<string, unknown>)[id];
            if (typeof aVal === 'number' && typeof bVal === 'number') {
              return desc ? bVal - aVal : aVal - bVal;
            }
            const aStr = String(aVal ?? '').toLowerCase();
            const bStr = String(bVal ?? '').toLowerCase();
            return desc ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
          });
        }
      } catch {
        // Invalid sort param — ignore
      }
    }

    const totalProducts = allProducts.length;

    // Pagination logic
    const offset = (page - 1) * limit;
    const paginatedProducts = allProducts.slice(offset, offset + limit);

    // Mock current time
    const currentTime = new Date().toISOString();

    // Return paginated response
    return {
      success: true,
      time: currentTime,
      message: 'Sample data for testing and learning purposes',
      total_products: totalProducts,
      offset,
      limit,
      products: paginatedProducts
    };
  },

  // Get a specific product by its ID
  async getProductById(id: number, organizationId?: string) {
    await delay(3000); // Simulate a slow API call

    // Find the product by its ID
    const product = organizationId
      ? this.records.find(
          (product) => product.id === id && product.organizationId === organizationId
        )
      : undefined;

    if (!product) {
      return {
        success: false,
        message: `Product with ID ${id} not found`
      };
    }

    // Mock current time
    const currentTime = new Date().toISOString();

    return {
      success: true,
      time: currentTime,
      message: `Product with ID ${id} found`,
      product
    };
  },

  // Create a new product
  async createProduct(
    data: Omit<Product, 'id' | 'organizationId' | 'created_at' | 'updated_at' | 'photo_url'>,
    organizationId?: string
  ) {
    await delay(1000);

    if (!organizationId) {
      throw new Error('Organization scope is required');
    }

    const newProduct: Product = {
      ...data,
      organizationId,
      id: this.records.length + 1,
      photo_url: `https://api.slingacademy.com/public/sample-products/${this.records.length + 1}.png`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.records.push(newProduct);

    return {
      success: true,
      message: 'Product created successfully',
      product: newProduct
    };
  },

  // Update an existing product
  async updateProduct(
    id: number,
    data: Omit<Product, 'id' | 'organizationId' | 'created_at' | 'updated_at' | 'photo_url'>,
    organizationId?: string
  ) {
    await delay(1000);

    if (!organizationId) {
      throw new Error('Organization scope is required');
    }

    const index = this.records.findIndex(
      (product) => product.id === id && product.organizationId === organizationId
    );

    if (index === -1) {
      return {
        success: false,
        message: `Product with ID ${id} not found`
      };
    }

    this.records[index] = {
      ...this.records[index],
      ...data,
      updated_at: new Date().toISOString()
    };

    return {
      success: true,
      message: 'Product updated successfully',
      product: this.records[index]
    };
  },

  // Delete a product
  async deleteProduct(id: number, organizationId?: string) {
    await delay(1000);

    if (!organizationId) {
      throw new Error('Organization scope is required');
    }

    const index = this.records.findIndex(
      (product) => product.id === id && product.organizationId === organizationId
    );

    if (index === -1) {
      return { success: false, message: `Product with ID ${id} not found` };
    }

    this.records.splice(index, 1);

    return {
      success: true,
      message: 'Product deleted successfully'
    };
  }
};

// Initialize sample products
fakeProducts.initialize();
