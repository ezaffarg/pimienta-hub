////////////////////////////////////////////////////////////////////////////////
// 🛑 Nothing in here has anything to do with Nextjs, it's just a fake database
////////////////////////////////////////////////////////////////////////////////

import { faker } from '@faker-js/faker';
import { matchSorter } from 'match-sorter';
import { MOCK_ORGANIZATIONS } from './mock-tenants';

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type User = {
  organizationId: string;
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  status: string;
  role: string;
  created_at: string;
  updated_at: string;
};

function generateRandomUserData(id: number): User {
  const roles = ['Developer', 'Designer', 'Manager', 'QA', 'DevOps', 'Product Owner'];
  const statuses = ['Active', 'Inactive', 'Invited'];

  return {
    organizationId: id % 2 === 0 ? MOCK_ORGANIZATIONS.orgB : MOCK_ORGANIZATIONS.orgA,
    id,
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    email: faker.internet.email(),
    phone: faker.phone.number({ style: 'national' }),
    status: faker.helpers.arrayElement(statuses),
    role: faker.helpers.arrayElement(roles),
    created_at: faker.date.between({ from: '2022-01-01', to: '2023-12-31' }).toISOString(),
    updated_at: faker.date.recent().toISOString()
  };
}

// Mock user data store
export const fakeUsers = {
  records: [] as User[],

  initialize() {
    const sampleUsers: User[] = [];
    for (let i = 1; i <= 50; i++) {
      sampleUsers.push(generateRandomUserData(i));
    }

    this.records = sampleUsers;
  },

  async getAll({
    organizationId,
    roles = [],
    search
  }: {
    organizationId?: string;
    roles?: string[];
    search?: string;
  }) {
    let users = organizationId
      ? this.records.filter((user) => user.organizationId === organizationId)
      : [];

    if (roles.length > 0) {
      users = users.filter((user) => roles.includes(user.role));
    }

    if (search) {
      users = matchSorter(users, search, {
        keys: ['first_name', 'last_name', 'email']
      });
    }

    return users;
  },

  async getUserById(id: number, organizationId?: string) {
    await delay(800);

    const user = organizationId
      ? this.records.find((record) => record.id === id && record.organizationId === organizationId)
      : undefined;

    if (!user) {
      return { success: false, message: `User with ID ${id} not found` };
    }

    return {
      success: true,
      message: `User with ID ${id} found`,
      user
    };
  },

  async createUser(
    data: Omit<User, 'id' | 'organizationId' | 'role' | 'created_at' | 'updated_at'>,
    organizationId?: string
  ) {
    await delay(800);

    if (!organizationId) {
      throw new Error('Organization scope is required');
    }

    const newUser: User = {
      ...data,
      organizationId,
      role: 'Member',
      id: this.records.length + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.records.push(newUser);

    return {
      success: true,
      message: 'User created successfully',
      user: newUser
    };
  },

  async updateUser(
    id: number,
    data: Omit<User, 'id' | 'organizationId' | 'role' | 'created_at' | 'updated_at'>,
    organizationId?: string
  ) {
    await delay(800);

    if (!organizationId) {
      throw new Error('Organization scope is required');
    }

    const index = this.records.findIndex(
      (user) => user.id === id && user.organizationId === organizationId
    );

    if (index === -1) {
      return { success: false, message: `User with ID ${id} not found` };
    }

    this.records[index] = {
      ...this.records[index],
      ...data,
      updated_at: new Date().toISOString()
    };

    return {
      success: true,
      message: 'User updated successfully',
      user: this.records[index]
    };
  },

  async deleteUser(id: number, organizationId?: string) {
    await delay(800);

    if (!organizationId) {
      throw new Error('Organization scope is required');
    }

    const index = this.records.findIndex(
      (user) => user.id === id && user.organizationId === organizationId
    );

    if (index === -1) {
      return { success: false, message: `User with ID ${id} not found` };
    }

    this.records.splice(index, 1);

    return {
      success: true,
      message: 'User deleted successfully'
    };
  },

  async getUsers({
    organizationId,
    page = 1,
    limit = 10,
    roles,
    search,
    sort
  }: {
    organizationId?: string;
    page?: number;
    limit?: number;
    roles?: string | string[];
    search?: string;
    sort?: string;
  }) {
    await delay(800);
    const rolesArray = roles ? (Array.isArray(roles) ? roles : String(roles).split(/[.,]/)) : [];
    const allUsers = await this.getAll({
      organizationId,
      roles: rolesArray,
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
          allUsers.sort((a, b) => {
            // Handle computed 'name' column
            const aVal =
              id === 'name' ? `${a.first_name} ${a.last_name}` : (a as Record<string, unknown>)[id];
            const bVal =
              id === 'name' ? `${b.first_name} ${b.last_name}` : (b as Record<string, unknown>)[id];
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

    const totalUsers = allUsers.length;

    const offset = (page - 1) * limit;
    const paginatedUsers = allUsers.slice(offset, offset + limit);

    return {
      success: true,
      time: new Date().toISOString(),
      message: 'Sample data for testing and learning purposes',
      total_users: totalUsers,
      offset,
      limit,
      users: paginatedUsers
    };
  }
};

fakeUsers.initialize();
