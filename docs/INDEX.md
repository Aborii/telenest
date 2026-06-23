# Documentation Index

Complete guide to `nestjs-telegram` — Navigate to the documentation you need.

---

## 📚 Documentation Structure

### Getting Started

**New to the library? Start here!**

- **[GETTING-STARTED.md](./GETTING-STARTED.md)** ⭐
  - Quick installation guide
  - First bot in 5 minutes
  - First MTProto client setup
  - Basic examples
  - Troubleshooting

### Core Documentation

**Deep dive into features**

- **[BOT-API.md](./BOT-API.md)**
  - Complete Bot API reference
  - Module configuration
  - TelegramBotService methods
  - Polling vs webhook
  - Error handling
- **[USER-CLIENT-MTPROTO.md](./USER-CLIENT-MTPROTO.md)**
  - MTProto client guide
  - Authentication flow
  - Session management
  - User operations
  - DTOs and types

- **[BOT-UPDATE-DECORATORS.md](./BOT-UPDATE-DECORATORS.md)**
  - Decorator-based handlers
  - `@TelegramUpdate`, `@Command`, `@Action`
  - Parameter injection
  - Best practices

- **[BOT-GUARDS-FILTERS-INTERCEPTORS.md](./BOT-GUARDS-FILTERS-INTERCEPTORS.md)**
  - Guards, interceptors, exception filters
  - `@UseTelegramGuards` / `@UseTelegramInterceptors` / `@UseTelegramFilters`
  - Built-in allowlist & rate-limit guards
  - DI, execution order, custom enhancers

- **[MULTIPLE-BOTS.md](./MULTIPLE-BOTS.md)**
  - Several named bots in one app
  - `@InjectBot(name)` + `getBotToken`
  - `@TelegramUpdate({ bot })` handler scoping
  - Per-bot isolation & lifecycle

- **[WEBHOOK-CONTROLLER.md](./WEBHOOK-CONTROLLER.md)**
  - Built-in `POST {path}` webhook controller
  - Constant-time secret-token verification
  - Auto `setWebhook` on bootstrap (opt-in)
  - One route per named bot

- **[MULTIPLE-ACCOUNTS.md](./MULTIPLE-ACCOUNTS.md)**
  - Several named MTProto user accounts in one app
  - `@InjectTelegramUser(name)` / `@InjectTelegramAuth(name)`
  - `@OnUserMessage(filter, { client })` handler scoping
  - Per-account sessions, isolation & lifecycle

- **[AUTHENTICATION.md](./AUTHENTICATION.md)**
  - MTProto authentication deep-dive
  - Login state machine
  - 2FA handling
  - Session persistence

- **[SESSION-STORES.md](./SESSION-STORES.md)**
  - `SessionStore` contract and built-in stores
  - `RedisSessionStore` / `KeyValueSessionStore`
  - `EncryptedSessionStore` (AES-256-GCM at rest)
  - Composing stores & security notes

- **[OBSERVABILITY.md](./OBSERVABILITY.md)**
  - Per-side health indicators (`@nestjs/terminus`-compatible, zero-import)
  - Metrics counters (sent/received/errors/flood-waits) + `snapshot()`
  - OpenTelemetry tracing via a guarded, opt-in bridge
  - DI tokens and how to bridge to Prometheus

### Reference Documentation

- **[API-REFERENCE.md](./API-REFERENCE.md)** 📖
  - Complete API reference
  - All classes and methods
  - Type definitions
  - Injection tokens
  - Error types

- **[EXAMPLES.md](./EXAMPLES.md)** 💡
  - Practical recipes
  - Common use cases
  - Copy-paste examples
  - Bot patterns
  - MTProto patterns
  - Hybrid examples

- **[ADVANCED-USAGE.md](./ADVANCED-USAGE.md)** 🚀
  - Architecture patterns
  - Performance optimization
  - Production deployment
  - Security best practices
  - Monitoring and logging

### Specialized Topics

- **[MINI-APP-INIT-DATA.md](./MINI-APP-INIT-DATA.md)**
  - Telegram Mini App integration
  - Init data validation
  - Security considerations

- **[TELEGRAM-BOT-PLATFORM.md](./TELEGRAM-BOT-PLATFORM.md)**
  - Platform overview
  - Bot capabilities
  - Limitations

- **[TELEGRAM-MODULE.md](./TELEGRAM-MODULE.md)**
  - Architecture overview
  - Module composition
  - Umbrella module
  - Design decisions

- **[TESTING.md](./TESTING.md)**
  - Testing strategies
  - Unit tests
  - Integration tests
  - Mocking strategies

- **[LINTING-AND-FORMATTING.md](./LINTING-AND-FORMATTING.md)**
  - ESLint flat config (no-any / no-enum / boundary types)
  - Prettier formatting + import sorting
  - `lint` / `lint:fix` / `format` / `format:check` scripts
  - How to extend the rules

---

## 🎯 Quick Navigation by Use Case

### I want to build a Telegram bot

1. Start: [GETTING-STARTED.md § Bot API](./GETTING-STARTED.md#quick-start-bot-api)
2. Learn: [BOT-API.md](./BOT-API.md)
3. Examples: [EXAMPLES.md § Bot API](./EXAMPLES.md#bot-api-examples)
4. Advanced: [BOT-UPDATE-DECORATORS.md](./BOT-UPDATE-DECORATORS.md)

### I want to automate my Telegram account

1. Start: [GETTING-STARTED.md § MTProto](./GETTING-STARTED.md#quick-start-mtproto-client)
2. Learn: [USER-CLIENT-MTPROTO.md](./USER-CLIENT-MTPROTO.md)
3. Auth: [AUTHENTICATION.md](./AUTHENTICATION.md)
4. Examples: [EXAMPLES.md § MTProto](./EXAMPLES.md#mtproto-client-examples)
5. Multiple accounts: [MULTIPLE-ACCOUNTS.md](./MULTIPLE-ACCOUNTS.md)

### I want to use both Bot + User Account

1. Start: [GETTING-STARTED.md § Both APIs](./GETTING-STARTED.md#using-both-apis-together)
2. Module: [TELEGRAM-MODULE.md](./TELEGRAM-MODULE.md)
3. Examples: [EXAMPLES.md § Hybrid](./EXAMPLES.md#hybrid-examples)

### I want to build a Telegram Mini App backend

1. Validation: [MINI-APP-INIT-DATA.md](./MINI-APP-INIT-DATA.md)
2. Example: [EXAMPLES.md § Mini App](./EXAMPLES.md#mini-app-init-data-validation)
3. Security: [ADVANCED-USAGE.md § Security](./ADVANCED-USAGE.md#security-best-practices)

### I want to test my bot/client code

1. Guide: [TESTING.md](./TESTING.md)
2. Examples: [EXAMPLES.md § Testing](./EXAMPLES.md#testing-examples)
3. Patterns: [ADVANCED-USAGE.md § Testing](./ADVANCED-USAGE.md#testing-strategies)

### I want to deploy to production

1. Config: [ADVANCED-USAGE.md § Deployment](./ADVANCED-USAGE.md#production-deployment)
2. Security: [ADVANCED-USAGE.md § Security](./ADVANCED-USAGE.md#security-best-practices)
3. Monitoring: [ADVANCED-USAGE.md § Monitoring](./ADVANCED-USAGE.md#monitoring--logging)

---

## 📖 Documentation by Topic

### Configuration

| Topic                 | Document                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Bot module setup      | [BOT-API.md § Registering the module](./BOT-API.md#2-registering-the-module)                                           |
| Client module setup   | [USER-CLIENT-MTPROTO.md § Configuring](./USER-CLIENT-MTPROTO.md#3-configuring-telegramclientmodule)                    |
| Environment variables | [GETTING-STARTED.md § Environment](./GETTING-STARTED.md#common-patterns)                                               |
| Async configuration   | [API-REFERENCE.md § forRootAsync](./API-REFERENCE.md#forrootasync-options-telegrambotmoduleasyncoptions-dynamicmodule) |

### Messaging

| Topic                | Document                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Send messages (Bot)  | [API-REFERENCE.md § sendMessage](./API-REFERENCE.md#sendmessagechatid-text-extra-promisemessage)                                            |
| Send messages (User) | [API-REFERENCE.md § TelegramUserService](./API-REFERENCE.md#sendmessagepeer-grampeer-text-string--gramsendmessageparams-promisegrammessage) |
| Send files/media     | [EXAMPLES.md § Sending Files](./EXAMPLES.md#sending-files--media)                                                                           |
| Keyboards            | [API-REFERENCE.md § Keyboard Builders](./API-REFERENCE.md#keyboard-builders)                                                                |
| Inline buttons       | [EXAMPLES.md § Inline Keyboards](./EXAMPLES.md#inline-keyboards--callback-handling)                                                         |

### Handlers & Events

| Topic                    | Document                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Command handlers            | [BOT-API.md § Registering handlers](./BOT-API.md#5-registering-handlers)            |
| Decorators                  | [BOT-UPDATE-DECORATORS.md](./BOT-UPDATE-DECORATORS.md)                              |
| Guards/filters/interceptors | [BOT-GUARDS-FILTERS-INTERCEPTORS.md](./BOT-GUARDS-FILTERS-INTERCEPTORS.md)          |
| Multiple named bots         | [MULTIPLE-BOTS.md](./MULTIPLE-BOTS.md)                                              |
| Callback queries            | [EXAMPLES.md § Inline Keyboards](./EXAMPLES.md#inline-keyboards--callback-handling) |
| Incoming messages (User)    | [EXAMPLES.md § Listen to Messages](./EXAMPLES.md#listen-to-incoming-messages)       |
| Multiple user accounts      | [MULTIPLE-ACCOUNTS.md](./MULTIPLE-ACCOUNTS.md)                                      |

### Authentication

| Topic              | Document                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------- |
| Bot token          | [GETTING-STARTED.md § Get Token](./GETTING-STARTED.md#1-get-your-bot-token)               |
| MTProto login      | [AUTHENTICATION.md § Flow](./AUTHENTICATION.md#4-authentication-flow)                     |
| Session management | [USER-CLIENT-MTPROTO.md § Sessions](./USER-CLIENT-MTPROTO.md#5-sessions-and-sessionstore) |
| 2FA                | [AUTHENTICATION.md](./AUTHENTICATION.md)                                                  |

### Data & Types

| Topic       | Document                                                               |
| ----------- | ---------------------------------------------------------------------- |
| DTOs        | [API-REFERENCE.md § DTOs](./API-REFERENCE.md#dtos--types)              |
| Error types | [API-REFERENCE.md § Errors](./API-REFERENCE.md#error-hierarchy)        |
| Type safety | [ADVANCED-USAGE.md § Validation](./ADVANCED-USAGE.md#input-validation) |

### Testing

| Topic         | Document                                                                  |
| ------------- | ------------------------------------------------------------------------- |
| Unit tests    | [TESTING.md § Unit Testing](./TESTING.md#2-testing-your-application-code) |
| Mocking       | [EXAMPLES.md § Testing](./EXAMPLES.md#testing-examples)                   |
| Test patterns | [ADVANCED-USAGE.md § Testing](./ADVANCED-USAGE.md#testing-strategies)     |

### Advanced

| Topic                 | Document                                                                             |
| --------------------- | ------------------------------------------------------------------------------------ |
| Architecture patterns | [ADVANCED-USAGE.md § Architecture](./ADVANCED-USAGE.md#architecture-patterns)        |
| Performance           | [ADVANCED-USAGE.md § Performance](./ADVANCED-USAGE.md#performance-optimization)      |
| Rate limiting         | [ADVANCED-USAGE.md § Rate Limiting](./ADVANCED-USAGE.md#rate-limiting)               |
| Error handling        | [ADVANCED-USAGE.md § Error Handling](./ADVANCED-USAGE.md#error-handling--resilience) |
| Security              | [ADVANCED-USAGE.md § Security](./ADVANCED-USAGE.md#security-best-practices)          |
| Production            | [ADVANCED-USAGE.md § Deployment](./ADVANCED-USAGE.md#production-deployment)          |

---

## 🔍 Find by Feature

### Bot API Features

| Feature             | Quick Link                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Send text message   | [API-REFERENCE.md](./API-REFERENCE.md#sendmessagechatid-text-extra-promisemessage)                                     |
| Send photo          | [API-REFERENCE.md](./API-REFERENCE.md#sendphotochatid-photo-extra-promisemessage)                                      |
| Send file           | [API-REFERENCE.md](./API-REFERENCE.md#senddocumentchatid-document-extra-promisemessage)                                |
| Edit message        | [API-REFERENCE.md](./API-REFERENCE.md#editmessagetextchatid-messageid-inlinemessageid-text-extra-promisemessage--true) |
| Delete message      | [API-REFERENCE.md](./API-REFERENCE.md#deletemessagechatid-messageid-promisetrue)                                       |
| Inline keyboard     | [EXAMPLES.md](./EXAMPLES.md#inline-keyboards--callback-handling)                                                       |
| Reply keyboard      | [EXAMPLES.md](./EXAMPLES.md#custom-reply-keyboard)                                                                     |
| Commands            | [EXAMPLES.md](./EXAMPLES.md#command-handler-with-parameters)                                                           |
| Callback queries    | [EXAMPLES.md](./EXAMPLES.md#inline-keyboards--callback-handling)                                                       |
| Webhook (built-in)  | [WEBHOOK-CONTROLLER.md](./WEBHOOK-CONTROLLER.md)                                                                       |
| Webhook (manual)    | [EXAMPLES.md](./EXAMPLES.md#webhook-mode)                                                                              |
| Mini App validation | [MINI-APP-INIT-DATA.md](./MINI-APP-INIT-DATA.md)                                                                       |

### MTProto Features

| Feature           | Quick Link                                                  |
| ----------------- | ----------------------------------------------------------- |
| Login             | [EXAMPLES.md](./EXAMPLES.md#login-flow)                     |
| Get dialogs       | [EXAMPLES.md](./EXAMPLES.md#list-recent-chats)              |
| Get messages      | [EXAMPLES.md](./EXAMPLES.md#read-messages-from-a-channel)   |
| Send message      | [EXAMPLES.md](./EXAMPLES.md#send-message-to-saved-messages) |
| Listen to updates | [EXAMPLES.md](./EXAMPLES.md#listen-to-incoming-messages)    |
| Session stores    | [API-REFERENCE.md](./API-REFERENCE.md#session-stores)       |

---

## 📦 Package Exports

The library uses subpath exports to load only what you need:

| Import Path              | Includes            | Use When                        |
| ------------------------ | ------------------- | ------------------------------- |
| `nestjs-telegram`        | Both Bot + Client   | Using both APIs                 |
| `nestjs-telegram/bot`    | Bot API only        | Bot-only app (no GramJS)        |
| `nestjs-telegram/client` | MTProto only        | User account only (no Telegraf) |
| `nestjs-telegram/common` | Shared types/errors | Type imports only               |

**Example:**

```typescript
// Load only Bot API
import { TelegramBotModule, TelegramBotService } from "nestjs-telegram/bot";

// Load only MTProto
import { TelegramClientModule, TelegramUserService } from "nestjs-telegram/client";

// Load both
import { TelegramModule } from "nestjs-telegram";
```

---

## 🆘 Getting Help

### Before Asking

1. Check [GETTING-STARTED.md](./GETTING-STARTED.md) for setup issues
2. Search [API-REFERENCE.md](./API-REFERENCE.md) for method signatures
3. Browse [EXAMPLES.md](./EXAMPLES.md) for similar use cases
4. Review error types in [API-REFERENCE.md § Errors](./API-REFERENCE.md#error-hierarchy)

### Common Issues

| Problem             | Solution                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Bot not responding  | [GETTING-STARTED.md § Troubleshooting](./GETTING-STARTED.md#troubleshooting)                |
| MTProto login fails | [AUTHENTICATION.md](./AUTHENTICATION.md)                                                    |
| Import errors       | Use correct [subpath imports](#-package-exports)                                            |
| Type errors         | Check [API-REFERENCE.md § Types](./API-REFERENCE.md#shared-types)                           |
| Testing issues      | See [TESTING.md](./TESTING.md)                                                              |
| Production errors   | Review [ADVANCED-USAGE.md § Error Handling](./ADVANCED-USAGE.md#error-handling--resilience) |

### Resources

- 📖 Full docs in [docs/](../docs/) folder
- 💻 Example code in [examples/](../examples/) folder
- 🐛 [GitHub Issues](https://github.com/Aborii/nestjs-telegram/issues)
- 📝 [README.md](../README.md) for overview

---

## 🗺️ Documentation Map

Visual guide to documentation structure:

```
nestjs-telegram/
├── README.md                     ← Start here: Overview
└── docs/
    ├── INDEX.md                  ← You are here
    │
    ├── GETTING-STARTED.md        ← Quick start for new users
    │   ├── Installation
    │   ├── First bot
    │   ├── First MTProto setup
    │   └── Troubleshooting
    │
    ├── Core Documentation
    │   ├── BOT-API.md            ← Complete Bot API guide
    │   ├── USER-CLIENT-MTPROTO.md ← MTProto client guide
    │   ├── BOT-UPDATE-DECORATORS.md ← Decorator handlers
    │   ├── MULTIPLE-BOTS.md      ← Several named bots in one app
    │   ├── MULTIPLE-ACCOUNTS.md  ← Several named user accounts in one app
    │   ├── AUTHENTICATION.md     ← Auth deep-dive
    │   └── OBSERVABILITY.md      ← Health, metrics & tracing
    │
    ├── Reference
    │   ├── API-REFERENCE.md      ← All APIs, methods, types
    │   ├── EXAMPLES.md           ← Practical recipes
    │   └── ADVANCED-USAGE.md     ← Patterns & best practices
    │
    ├── Specialized
    │   ├── MINI-APP-INIT-DATA.md ← Mini App validation
    │   ├── TELEGRAM-BOT-PLATFORM.md ← Platform info
    │   ├── TELEGRAM-MODULE.md    ← Architecture
    │   └── TESTING.md            ← Testing guide
    │
    └── examples/
        ├── decorator-bot.example.ts
        ├── example-app.module.ts
        └── login-cli.ts
```

---

## 🚀 Quick Links

**Most Popular Pages:**

1. [Getting Started](./GETTING-STARTED.md) — First-time setup
2. [API Reference](./API-REFERENCE.md) — Look up methods
3. [Examples](./EXAMPLES.md) — Copy-paste recipes
4. [Bot API Guide](./BOT-API.md) — Build bots
5. [MTProto Guide](./USER-CLIENT-MTPROTO.md) — Automate your account

**By Experience Level:**

- **Beginner**: [GETTING-STARTED.md](./GETTING-STARTED.md) → [EXAMPLES.md](./EXAMPLES.md)
- **Intermediate**: [BOT-API.md](./BOT-API.md) → [USER-CLIENT-MTPROTO.md](./USER-CLIENT-MTPROTO.md) → [BOT-UPDATE-DECORATORS.md](./BOT-UPDATE-DECORATORS.md)
- **Advanced**: [ADVANCED-USAGE.md](./ADVANCED-USAGE.md) → [TELEGRAM-MODULE.md](./TELEGRAM-MODULE.md)

---

**Happy coding!** 🎉

If you find these docs helpful, consider ⭐ starring the [repository](https://github.com/Aborii/nestjs-telegram)!
