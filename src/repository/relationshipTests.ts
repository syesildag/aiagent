/**
 * Test file demonstrating OneToOne and OneToMany relationship annotations
 * with cascade operations and lazy loading
 */

import { Entity, AbstractRepository, Constructor } from './abstractRepository';
import { Column } from './annotations/Column';
import { Id } from './annotations/Id';
import { OneToOne } from './annotations/OneToOne';
import { OneToMany } from './annotations/OneToMany';
import { repository } from './repository';
import { Table } from './table';
import { LazyLoadingUtils } from './lazyLoading';

// Test entities to demonstrate relationships

/**
 * User entity with OneToMany relationship to Orders
 */
export class User extends Entity {
  private id?: number;
  private name: string;
  private email: string;
  private profile?: UserProfile;
  private orders?: Order[];

  constructor({ id, name, email }: { id?: number; name: string; email: string }) {
    super();
    this.id = id;
    this.name = name;
    this.email = email;
  }

  @Id('id')
  public getId(): number | undefined {
    return this.id;
  }

  @Column({ columnName: 'name', notNull: true })
  public getName(): string {
    return this.name;
  }

  @Column({ columnName: 'email', notNull: true, unique: true })
  public getEmail(): string {
    return this.email;
  }

  @OneToOne({
    target: () => UserProfile,
    joinColumn: 'profile_id',
    cascadeSave: true,
    cascadeDelete: false,
    lazy: false // Eager load profile
  })
  public getProfile(): UserProfile | undefined {
    return this.profile;
  }

  public setProfile(profile: UserProfile | undefined) {
    this.profile = profile;
  }

  @OneToMany({
    target: () => Order,
    mappedBy: 'user_id',
    cascadeSave: true,
    cascadeDelete: true,
    lazy: true // Lazy load orders for performance
  })
  public getOrders(): Order[] | undefined {
    return this.orders;
  }

  public setOrders(orders: Order[] | undefined) {
    this.orders = orders;
  }
}

/**
 * UserProfile entity with OneToOne relationship to User
 */
export class UserProfile extends Entity {
  private id?: number;
  private firstName: string;
  private lastName: string;
  private bio?: string;

  constructor({ id, firstName, lastName, bio }: { 
    id?: number; 
    firstName: string; 
    lastName: string; 
    bio?: string;
  }) {
    super();
    this.id = id;
    this.firstName = firstName;
    this.lastName = lastName;
    this.bio = bio;
  }

  @Id('id')
  public getId(): number | undefined {
    return this.id;
  }

  @Column({ columnName: 'first_name', notNull: true })
  public getFirstName(): string {
    return this.firstName;
  }

  @Column({ columnName: 'last_name', notNull: true })
  public getLastName(): string {
    return this.lastName;
  }

  @Column({ columnName: 'bio' })
  public getBio(): string | undefined {
    return this.bio;
  }
}

/**
 * Order entity with OneToMany relationship to OrderItems
 */
export class Order extends Entity {
  private id?: number;
  private userId: number;
  private orderDate: Date;
  private total: number;
  private items?: OrderItem[];

  constructor({ id, userId, orderDate, total }: {
    id?: number;
    userId: number;
    orderDate: Date;
    total: number;
  }) {
    super();
    this.id = id;
    this.userId = userId;
    this.orderDate = orderDate;
    this.total = total;
  }

  @Id('id')
  public getId(): number | undefined {
    return this.id;
  }

  @Column({ columnName: 'user_id', notNull: true })
  public getUserId(): number {
    return this.userId;
  }

  @Column({ columnName: 'order_date', notNull: true })
  public getOrderDate(): Date {
    return this.orderDate;
  }

  @Column({ columnName: 'total', notNull: true })
  public getTotal(): number {
    return this.total;
  }

  @OneToMany({
    target: () => OrderItem,
    mappedBy: 'order_id',
    cascadeSave: true,
    cascadeDelete: true,
    lazy: false // Eager load order items
  })
  public getItems(): OrderItem[] | undefined {
    return this.items;
  }

  public setItems(items: OrderItem[] | undefined) {
    this.items = items;
  }
}

/**
 * OrderItem entity
 */
export class OrderItem extends Entity {
  private id?: number;
  private orderId: number;
  private productName: string;
  private quantity: number;
  private price: number;

  constructor({ id, orderId, productName, quantity, price }: {
    id?: number;
    orderId: number;
    productName: string;
    quantity: number;
    price: number;
  }) {
    super();
    this.id = id;
    this.orderId = orderId;
    this.productName = productName;
    this.quantity = quantity;
    this.price = price;
  }

  @Id('id')
  public getId(): number | undefined {
    return this.id;
  }

  @Column({ columnName: 'order_id', notNull: true })
  public getOrderId(): number {
    return this.orderId;
  }

  @Column({ columnName: 'product_name', notNull: true })
  public getProductName(): string {
    return this.productName;
  }

  @Column({ columnName: 'quantity', notNull: true })
  public getQuantity(): number {
    return this.quantity;
  }

  @Column({ columnName: 'price', notNull: true })
  public getPrice(): number {
    return this.price;
  }
}

// Repositories
class UserRepository extends AbstractRepository<User> {
  constructor() {
    super('ai_agent_user' as Table, User);
  }
}

class UserProfileRepository extends AbstractRepository<UserProfile> {
  constructor() {
    super('ai_agent_user_profiles' as Table, UserProfile);
  }
}

class OrderRepository extends AbstractRepository<Order> {
  constructor() {
    super('ai_agent_orders' as Table, Order);
  }
}

class OrderItemRepository extends AbstractRepository<OrderItem> {
  constructor() {
    super('ai_agent_order_items' as Table, OrderItem);
  }
}

// Register repositories
const userRepository = new UserRepository();
const userProfileRepository = new UserProfileRepository();
const orderRepository = new OrderRepository();
const orderItemRepository = new OrderItemRepository();

repository.set(User, userRepository);
repository.set(UserProfile, userProfileRepository);
repository.set(Order, orderRepository);
repository.set(OrderItem, orderItemRepository);

// Test functions to demonstrate the functionality

/**
 * Test OneToOne relationship with eager loading
 */
export async function testOneToOneRelationship() {
  console.log('=== Testing OneToOne Relationship ===');
  
  // Create a user profile
  const profile = new UserProfile({
    firstName: 'John',
    lastName: 'Doe',
    bio: 'Software developer with 5 years of experience'
  });

  // Create a user with the profile
  const user = new User({
    name: 'johndoe',
    email: 'john.doe@example.com'
  });
  
  user.setProfile(profile);

  try {
    // Save user (should cascade save profile due to cascadeSave: true)
    const savedUser = await user.save();
    console.log('User saved with profile:', savedUser?.getName());
    
    // Retrieve user and check if profile is loaded eagerly
    const retrievedUser = await userRepository.getById(savedUser!.getId()!);
    if (retrievedUser) {
      const userProfile = retrievedUser.getProfile();
      console.log('Profile loaded:', userProfile ? 'Yes' : 'No');
      if (userProfile) {
        console.log('Profile name:', `${userProfile.getFirstName()} ${userProfile.getLastName()}`);
      }
    }
  } catch (error) {
    console.error('Error testing OneToOne relationship:', error);
  }
}

/**
 * Test OneToMany relationship with lazy loading
 */
export async function testOneToManyRelationship() {
  console.log('\n=== Testing OneToMany Relationship ===');
  
  // Create a user
  const user = new User({
    name: 'janedoe',
    email: 'jane.doe@example.com'
  });

  const savedUser = await user.save();
  if (!savedUser) {
    console.error('Failed to save user');
    return;
  }

  // Create orders
  const order1 = new Order({
    userId: savedUser.getId()!,
    orderDate: new Date(),
    total: 99.99
  });

  const order2 = new Order({
    userId: savedUser.getId()!,
    orderDate: new Date(),
    total: 149.99
  });

  // Create order items for order1
  const item1 = new OrderItem({
    orderId: 0, // Will be set after order is saved
    productName: 'Widget A',
    quantity: 2,
    price: 29.99
  });

  const item2 = new OrderItem({
    orderId: 0, // Will be set after order is saved
    productName: 'Widget B',
    quantity: 1,
    price: 39.99
  });

  try {
    // Save orders
    const savedOrder1 = await order1.save();
    const savedOrder2 = await order2.save();
    
    if (savedOrder1 && savedOrder2) {
      console.log('Orders saved successfully');
      
      // Set order items
      item1.getOrderId = () => savedOrder1.getId()!;
      item2.getOrderId = () => savedOrder1.getId()!;
      savedOrder1.setItems([item1, item2]);
      
      // Save order with items (should cascade)
      await savedOrder1.save();
      console.log('Order items saved via cascade');

      // Retrieve user and check lazy loading of orders
      const retrievedUser = await userRepository.getById(savedUser.getId()!);
      if (retrievedUser) {
        const ordersProxy = retrievedUser.getOrders();
        console.log('Orders are lazy loaded:', LazyLoadingUtils.isLazyProxy(ordersProxy));
        
        if (LazyLoadingUtils.isLazyProxy(ordersProxy)) {
          console.log('Loading orders...');
          const orders = await LazyLoadingUtils.getValue(ordersProxy);
          console.log('Number of orders loaded:', orders.length);
          
          // Test lazy loading of order items
          if (orders.length > 0) {
            const firstOrder = orders[0];
            const items = firstOrder.getItems();
            if (Array.isArray(items)) {
              console.log('Number of items in first order:', items.length);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error testing OneToMany relationship:', error);
  }
}

/**
 * Test cascade delete functionality
 */
export async function testCascadeDelete() {
  console.log('\n=== Testing Cascade Delete ===');
  
  // Create user with orders
  const user = new User({
    name: 'testuser',
    email: 'test.user@example.com'
  });

  const savedUser = await user.save();
  if (!savedUser) {
    console.error('Failed to save user');
    return;
  }

  // Create an order
  const order = new Order({
    userId: savedUser.getId()!,
    orderDate: new Date(),
    total: 50.00
  });

  const savedOrder = await order.save();
  if (!savedOrder) {
    console.error('Failed to save order');
    return;
  }

  console.log('Created user with order');

  try {
    // Delete user (should cascade delete orders due to cascadeDelete: true)
    await savedUser.delete();
    console.log('User deleted');
    
    // Check if order was also deleted
    const deletedOrder = await orderRepository.getById(savedOrder.getId()!);
    console.log('Order cascade deleted:', deletedOrder === null ? 'Yes' : 'No');
    
  } catch (error) {
    console.error('Error testing cascade delete:', error);
  }
}

/**
 * Run all relationship tests
 */
export async function runRelationshipTests() {
  console.log('Starting relationship annotation tests...\n');
  
  try {
    await testOneToOneRelationship();
    await testOneToManyRelationship();
    await testCascadeDelete();
    
    console.log('\n=== All Tests Completed ===');
  } catch (error) {
    console.error('Error running tests:', error);
  }
}

// Export for use in other files or run directly
if (require.main === module) {
  runRelationshipTests();
}