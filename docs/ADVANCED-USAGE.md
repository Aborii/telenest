# Advanced Usage & Best Practices

Advanced patterns, performance tips, and production-ready practices for `telenest`.

---

## Table of Contents

- [Architecture Patterns](#architecture-patterns)
  - [Clean Separation of Concerns](#clean-separation-of-concerns)
  - [Domain-Driven Design with Bots](#domain-driven-design-with-bots)
  - [CQRS Pattern](#cqrs-pattern)
- [Performance Optimization](#performance-optimization)
  - [Rate Limiting](#rate-limiting)
  - [Caching Strategies](#caching-strategies)
  - [Bulk Operations](#bulk-operations)
- [Error Handling & Resilience](#error-handling--resilience)
  - [Graceful Degradation](#graceful-degradation)
  - [Retry Strategies](#retry-strategies)
  - [Circuit Breakers](#circuit-breakers)
- [Security Best Practices](#security-best-practices)
  - [Input Validation](#input-validation)
  - [Secret Management](#secret-management)
  - [User Authorization](#user-authorization)
- [Production Deployment](#production-deployment)
  - [Environment Configuration](#environment-configuration)
  - [Health Checks](#health-checks)
  - [Graceful Shutdown](#graceful-shutdown)
  - [Monitoring & Logging](#monitoring--logging)

---

## Architecture Patterns

### Clean Separation of Concerns

Organize bot logic into distinct layers.

```typescript
// Domain layer - pure business logic
// user.entity.ts
export class User {
  constructor(
    public readonly id: number,
    public readonly username: string,
    public credits: number,
  ) {}

  canPerformAction(cost: number): boolean {
    return this.credits >= cost;
  }

  deductCredits(amount: number): void {
    if (!this.canPerformAction(amount)) {
      throw new Error("Insufficient credits");
    }
    this.credits -= amount;
  }
}

// Application layer - use cases
// create-task.use-case.ts
import { Injectable } from "@nestjs/common";
import { UserRepository } from "./user.repository";
import { TaskRepository } from "./task.repository";

@Injectable()
export class CreateTaskUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tasks: TaskRepository,
  ) {}

  async execute(userId: number, taskDescription: string) {
    const user = await this.users.findById(userId);

    if (!user.canPerformAction(10)) {
      throw new Error("Not enough credits");
    }

    const task = await this.tasks.create(userId, taskDescription);
    user.deductCredits(10);
    await this.users.save(user);

    return task;
  }
}

// Presentation layer - bot handlers
// tasks.update.ts
import { Injectable } from "@nestjs/common";
import { TelegramUpdate, Command, Ctx, Sender } from "telenest/bot";
import type { Context, User as TgUser } from "telegraf";
import { CreateTaskUseCase } from "./create-task.use-case";

@TelegramUpdate()
@Injectable()
export class TasksUpdate {
  constructor(private readonly createTask: CreateTaskUseCase) {}

  @Command("newtask")
  async onNewTask(@Ctx() ctx: Context, @Sender() from: TgUser) {
    const description = ctx.message.text.split(" ").slice(1).join(" ");

    if (!description) {
      await ctx.reply("Usage: /newtask <description>");
      return;
    }

    try {
      const task = await this.createTask.execute(from.id, description);
      await ctx.reply(`✅ Task created! ID: ${task.id}`);
    } catch (error) {
      await ctx.reply(`❌ ${error.message}`);
    }
  }
}
```

---

### Domain-Driven Design with Bots

Encapsulate business rules in domain objects.

```typescript
// task.entity.ts
export enum TaskStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export class Task {
  private constructor(
    public readonly id: string,
    public readonly userId: number,
    public description: string,
    public status: TaskStatus,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(userId: number, description: string): Task {
    return new Task(
      Math.random().toString(36).substr(2, 9),
      userId,
      description,
      TaskStatus.PENDING,
      new Date(),
      new Date(),
    );
  }

  start(): void {
    if (this.status !== TaskStatus.PENDING) {
      throw new Error("Can only start pending tasks");
    }
    this.status = TaskStatus.IN_PROGRESS;
    this.updatedAt = new Date();
  }

  complete(): void {
    if (this.status !== TaskStatus.IN_PROGRESS) {
      throw new Error("Can only complete tasks in progress");
    }
    this.status = TaskStatus.COMPLETED;
    this.updatedAt = new Date();
  }

  cancel(): void {
    if (this.status === TaskStatus.COMPLETED) {
      throw new Error("Cannot cancel completed tasks");
    }
    this.status = TaskStatus.CANCELLED;
    this.updatedAt = new Date();
  }

  canBeEdited(): boolean {
    return this.status === TaskStatus.PENDING || this.status === TaskStatus.IN_PROGRESS;
  }
}
```

---

### CQRS Pattern

Separate read and write models.

```typescript
// Commands
// create-user.command.ts
export class CreateUserCommand {
  constructor(
    public readonly telegramId: number,
    public readonly username: string,
  ) {}
}

// command handler
import { CommandHandler, ICommandHandler } from "@nestjs/cqrs";

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(private readonly repository: UserRepository) {}

  async execute(command: CreateUserCommand) {
    const user = new User(command.telegramId, command.username, 100);
    return this.repository.save(user);
  }
}

// Queries
// get-user-stats.query.ts
export class GetUserStatsQuery {
  constructor(public readonly userId: number) {}
}

@QueryHandler(GetUserStatsQuery)
export class GetUserStatsHandler implements IQueryHandler<GetUserStatsQuery> {
  constructor(private readonly repository: UserRepository) {}

  async execute(query: GetUserStatsQuery) {
    const user = await this.repository.findById(query.userId);
    const tasks = await this.repository.getUserTasks(query.userId);

    return {
      totalTasks: tasks.length,
      completedTasks: tasks.filter((t) => t.status === "completed").length,
      credits: user.credits,
    };
  }
}

// Usage in bot handler
@TelegramUpdate()
@Injectable()
export class StatsUpdate {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Command("stats")
  async onStats(@Ctx() ctx: Context, @Sender() from: TgUser) {
    const stats = await this.queryBus.execute(new GetUserStatsQuery(from.id));

    await ctx.reply(
      `📊 Your Statistics:\n` + `Tasks: ${stats.completedTasks}/${stats.totalTasks}\n` + `Credits: ${stats.credits}`,
    );
  }
}
```

---

## Performance Optimization

### Rate Limiting

Prevent abuse and respect Telegram limits.

```typescript
import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

// Global rate limiter
@Injectable()
export class TelegramThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: any): Promise<string> {
    // Rate limit per Telegram user ID
    return req.user?.id?.toString() || req.ip;
  }
}

// Per-user rate limiting
import { Inject, Injectable } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";

@Injectable()
export class UserRateLimiter {
  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}

  async checkLimit(userId: number, action: string, limit: number, windowMs: number): Promise<boolean> {
    const key = `ratelimit:${userId}:${action}`;
    const count = (await this.cache.get<number>(key)) || 0;

    if (count >= limit) {
      return false;
    }

    await this.cache.set(key, count + 1, windowMs);
    return true;
  }
}

// Usage
@TelegramUpdate()
@Injectable()
export class RateLimitedUpdate {
  constructor(private readonly rateLimiter: UserRateLimiter) {}

  @Command("expensive")
  async onExpensive(@Ctx() ctx: Context, @Sender() from: TgUser) {
    const allowed = await this.rateLimiter.checkLimit(
      from.id,
      "expensive",
      5, // 5 requests
      60000, // per minute
    );

    if (!allowed) {
      await ctx.reply("⏰ Rate limit exceeded. Try again in a minute.");
      return;
    }

    // Process expensive operation
    await ctx.reply("Processing...");
  }
}
```

---

### Caching Strategies

Cache expensive operations.

```typescript
import { Injectable, Inject } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import { TelegramUserService } from "telenest/client";

@Injectable()
export class CachedDialogsService {
  constructor(
    private readonly user: TelegramUserService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getDialogs(userId: string, limit: number) {
    const cacheKey = `dialogs:${userId}:${limit}`;

    // Try cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    // Fetch fresh data
    const dialogs = await this.user.getDialogs({ limit });

    // Cache for 5 minutes
    await this.cache.set(cacheKey, dialogs, 300000);

    return dialogs;
  }

  async invalidateCache(userId: string) {
    const keys = await this.cache.store.keys();
    const userKeys = keys.filter((k) => k.startsWith(`dialogs:${userId}:`));

    await Promise.all(userKeys.map((k) => this.cache.del(k)));
  }
}
```

---

### Bulk Operations

Efficiently process multiple operations.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramBotService } from "telenest/bot";

@Injectable()
export class BulkMessagingService {
  constructor(private readonly bot: TelegramBotService) {}

  async sendToMany(chatIds: number[], message: string) {
    const BATCH_SIZE = 30; // Telegram allows ~30 messages/second
    const DELAY_MS = 1000;

    for (let i = 0; i < chatIds.length; i += BATCH_SIZE) {
      const batch = chatIds.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map((chatId) =>
          this.bot.sendMessage(chatId, message).catch((err) => {
            console.error(`Failed to send to ${chatId}:`, err.message);
          }),
        ),
      );

      // Wait between batches to avoid rate limits
      if (i + BATCH_SIZE < chatIds.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }
  }
}
```

---

## Built-in helpers

Three exported helpers cover common Bot-API foot-guns; all are importable from
`telenest` (or `telenest/bot`).

- **`withRetry(fn, options?)`** — runs `fn`, retrying only on Telegram's
  `429 Too Many Requests` by waiting the reported `retry_after`. Non-rate-limit
  errors propagate immediately. `TelegramBotService.withRetry(...)` is the instance
  wrapper. Cap a single wait with `maxDelayMs` (omit for none).

- **`splitMessageText(text, limit?)`** — splits text into ≤4096-char chunks on
  line boundaries (never emitting an over-limit chunk). `TelegramBotService.sendLongMessage(chatId, text, extra?)` uses it and sends the chunks in order; when it splits, `reply_markup` is applied to the **last** chunk and `reply_parameters` to the **first** only. The splitter is **not** formatting-entity-aware, so a `parse_mode` entity that straddles a boundary can break — pre-split formatted output yourself.

- **`encodeCallbackData(value)` / `decodeCallbackData<T>(data)`** — JSON-encode a
  payload into a button's `callback_data`, enforcing Telegram's 64-byte limit on
  encode. **Decoded callback_data is not authenticated** — never trust it for
  authorization; re-derive the user from `ctx.from` and re-check server-side.

## Error Handling & Resilience

### Graceful Degradation

Handle failures without crashing.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramBotService } from "telenest/bot";
import { isTelegramError } from "telenest";

@Injectable()
export class ResilientMessagingService {
  constructor(private readonly bot: TelegramBotService) {}

  async sendWithFallback(chatId: number, message: string) {
    try {
      return await this.bot.sendMessage(chatId, message, {
        parse_mode: "MarkdownV2",
      });
    } catch (error) {
      if (isTelegramError(error) && error.kind === "bot-api") {
        // Markdown failed, try plain text
        console.warn("Markdown parse failed, falling back to plain text");
        return await this.bot.sendMessage(chatId, message);
      }
      throw error;
    }
  }

  async sendSafely(chatId: number, message: string) {
    try {
      return await this.bot.sendMessage(chatId, message);
    } catch (error) {
      if (isTelegramError(error)) {
        console.error(`Failed to send to ${chatId}:`, error.message);
        // Store in dead letter queue for later retry
        await this.enqueueFailedMessage(chatId, message, error);
        return null;
      }
      throw error;
    }
  }

  private async enqueueFailedMessage(chatId: number, message: string, error: Error) {
    // Store in database or queue for retry
  }
}
```

---

### Retry Strategies

Automatic retries with exponential backoff.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramAuthService } from "telenest/client";
import { isTelegramError } from "telenest";

@Injectable()
export class RetryableAuthService {
  constructor(private readonly auth: TelegramAuthService) {}

  async sendCodeWithRetry(phone: string, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.auth.sendCode(phone);
      } catch (error) {
        if (!isTelegramError(error) || attempt === maxRetries) {
          throw error;
        }

        if (error.kind === "auth" && error.code === "FLOOD_WAIT") {
          const waitTime = error.retryAfterSeconds || Math.pow(2, attempt) * 1000;
          console.log(`Flood wait: ${waitTime}s, attempt ${attempt}/${maxRetries}`);
          await this.sleep(waitTime * 1000);
        } else {
          // Exponential backoff for other errors
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw new Error("Max retries exceeded");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

---

### Circuit Breakers

Prevent cascading failures.

```typescript
import { Injectable } from "@nestjs/common";

interface CircuitState {
  failures: number;
  lastFailureTime?: number;
  state: "closed" | "open" | "half-open";
}

@Injectable()
export class CircuitBreaker {
  private circuits = new Map<string, CircuitState>();

  private readonly FAILURE_THRESHOLD = 5;
  private readonly TIMEOUT_MS = 60000; // 1 minute
  private readonly HALF_OPEN_REQUESTS = 3;

  async execute<T>(circuitName: string, operation: () => Promise<T>): Promise<T> {
    const circuit = this.getCircuit(circuitName);

    if (circuit.state === "open") {
      if (Date.now() - circuit.lastFailureTime! > this.TIMEOUT_MS) {
        circuit.state = "half-open";
        circuit.failures = 0;
      } else {
        throw new Error(`Circuit ${circuitName} is open`);
      }
    }

    try {
      const result = await operation();

      if (circuit.state === "half-open") {
        circuit.state = "closed";
        circuit.failures = 0;
      }

      return result;
    } catch (error) {
      circuit.failures++;
      circuit.lastFailureTime = Date.now();

      if (circuit.failures >= this.FAILURE_THRESHOLD) {
        circuit.state = "open";
        console.error(`Circuit ${circuitName} opened after ${circuit.failures} failures`);
      }

      throw error;
    }
  }

  private getCircuit(name: string): CircuitState {
    if (!this.circuits.has(name)) {
      this.circuits.set(name, {
        failures: 0,
        state: "closed",
      });
    }
    return this.circuits.get(name)!;
  }
}
```

---

## Security Best Practices

### Input Validation

Always validate user input.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramUpdate, Command, Ctx } from "telenest/bot";
import type { Context } from "telegraf";

@TelegramUpdate()
@Injectable()
export class SecureUpdate {
  @Command("transfer")
  async onTransfer(@Ctx() ctx: Context) {
    const args = ctx.message.text.split(" ").slice(1);
    const [recipientStr, amountStr] = args;

    // Validate recipient
    const recipientId = parseInt(recipientStr);
    if (!recipientId || recipientId < 0) {
      await ctx.reply("❌ Invalid recipient ID");
      return;
    }

    // Validate amount
    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0 || amount > 10000) {
      await ctx.reply("❌ Invalid amount (must be 0-10000)");
      return;
    }

    // Sanitize and validate against injection
    if (args.some((arg) => arg.includes("<") || arg.includes("script"))) {
      await ctx.reply("❌ Invalid input detected");
      return;
    }

    // Process transfer
    await this.processTransfer(ctx.from.id, recipientId, amount);
  }

  private async processTransfer(fromId: number, toId: number, amount: number) {
    // Your transfer logic
  }
}
```

---

### Secret Management

Never hardcode secrets.

```typescript
// config.service.ts
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class SecureConfigService {
  constructor(private config: ConfigService) {}

  getBotToken(): string {
    const token = this.config.get<string>("BOT_TOKEN");
    if (!token || token.includes("your_token_here")) {
      throw new Error("BOT_TOKEN not properly configured");
    }
    return token;
  }

  getTelegramSession(): string | undefined {
    const session = this.config.get<string>("TG_SESSION");

    // Never log the session
    if (session) {
      console.log("Session loaded (length:", session.length, ")");
    }

    return session;
  }

  // Load from external secrets manager (e.g., AWS Secrets Manager)
  async loadFromVault(secretName: string): Promise<string> {
    // Implementation here
    return "";
  }
}
```

---

### User Authorization

Role-based access control.

```typescript
import { Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

export enum UserRole {
  USER = "user",
  MODERATOR = "moderator",
  ADMIN = "admin",
}

export const Roles = (...roles: UserRole[]) => SetMetadata("roles", roles);

@Injectable()
export class AuthorizationService {
  private readonly userRoles = new Map<number, UserRole>(); // In production: use database

  constructor() {
    // Example: set admin users
    this.userRoles.set(123456789, UserRole.ADMIN);
  }

  getUserRole(userId: number): UserRole {
    return this.userRoles.get(userId) || UserRole.USER;
  }

  hasPermission(userId: number, requiredRole: UserRole): boolean {
    const userRole = this.getUserRole(userId);
    const hierarchy = [UserRole.USER, UserRole.MODERATOR, UserRole.ADMIN];

    return hierarchy.indexOf(userRole) >= hierarchy.indexOf(requiredRole);
  }
}

// Usage
@TelegramUpdate()
@Injectable()
export class AdminUpdate {
  constructor(private readonly auth: AuthorizationService) {}

  @Command("ban")
  async onBan(@Ctx() ctx: Context, @Sender() from: TgUser) {
    if (!this.auth.hasPermission(from.id, UserRole.MODERATOR)) {
      await ctx.reply("⛔ Insufficient permissions");
      return;
    }

    // Proceed with ban
  }
}
```

---

## Production Deployment

### Environment Configuration

Proper configuration management.

```typescript
// env.validation.ts
import { plainToClass } from "class-transformer";
import { IsString, IsNumber, IsOptional, validateSync } from "class-validator";

export class EnvironmentVariables {
  @IsString()
  BOT_TOKEN: string;

  @IsNumber()
  TG_API_ID: number;

  @IsString()
  TG_API_HASH: string;

  @IsOptional()
  @IsString()
  TG_SESSION?: string;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  REDIS_URL: string;

  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}

// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({
      validate,
      isGlobal: true,
    }),
  ],
})
export class AppModule {}
```

---

### Health Checks

Monitor application health.

```typescript
import { Injectable } from "@nestjs/common";
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from "@nestjs/terminus";
import { TelegramBotService } from "telenest/bot";
import { TelegramAuthService } from "telenest/client";

@Injectable()
export class TelegramHealthIndicator extends HealthIndicator {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly auth: TelegramAuthService,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // Check bot connection
      await this.bot.getMe();

      // Check MTProto connection
      const authorized = await this.auth.isAuthorized();

      if (!authorized) {
        throw new Error("MTProto not authorized");
      }

      return this.getStatus(key, true, { bot: "up", mtproto: "authorized" });
    } catch (error) {
      throw new HealthCheckError("Telegram check failed", this.getStatus(key, false, { error: error.message }));
    }
  }
}

// health.controller.ts
import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";

@Controller("health")
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private telegram: TelegramHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.telegram.isHealthy("telegram")]);
  }
}
```

---

### Graceful Shutdown

Handle termination signals properly.

```typescript
// main.ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  await app.listen(3000);

  // Handle shutdown signals
  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down gracefully...");
    await app.close();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("SIGINT received, shutting down gracefully...");
    await app.close();
    process.exit(0);
  });
}

bootstrap();
```

---

### Monitoring & Logging

Structured logging and error tracking.

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { TelegramUpdate, Use, Ctx } from "telenest/bot";
import type { Context } from "telegraf";
import * as Sentry from "@sentry/node";

@TelegramUpdate()
@Injectable()
export class MonitoringMiddleware {
  private readonly logger = new Logger(MonitoringMiddleware.name);

  @Use()
  async monitor(@Ctx() ctx: Context) {
    const start = Date.now();

    // Log request
    this.logger.log({
      updateType: ctx.updateType,
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId: ctx.chat?.id,
      message: ctx.message?.text,
    });

    try {
      // Continue to next middleware
      return;
    } catch (error) {
      // Track error in Sentry
      Sentry.captureException(error, {
        user: { id: ctx.from?.id.toString(), username: ctx.from?.username },
        tags: { updateType: ctx.updateType },
      });

      this.logger.error("Handler failed", error.stack);
      throw error;
    } finally {
      // Log duration
      const duration = Date.now() - start;
      this.logger.log(`Request completed in ${duration}ms`);
    }
  }
}
```

---

**For production deployment:**

- Use environment variables for all secrets
- Implement proper logging (Winston, Pino)
- Set up error tracking (Sentry, Rollbar)
- Monitor performance (Prometheus, Grafana)
- Implement health checks
- Use process managers (PM2, systemd)
- Set up automatic restarts
- Configure rate limiting
- Implement request timeouts
- Use database connection pooling

---

This completes the advanced usage guide. For more information, see:

- [GETTING-STARTED.md](./GETTING-STARTED.md)
- [API-REFERENCE.md](./API-REFERENCE.md)
- [EXAMPLES.md](./EXAMPLES.md)
- [TESTING.md](./TESTING.md)
