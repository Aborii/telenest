# Getting Started with telenest

This guide will help you get up and running with `telenest` in under 10 minutes. We'll cover both the **Bot API** (for creating Telegram bots) and the **MTProto Client** (for controlling your own account).

---

## Table of Contents

- [Getting Started with telenest](#getting-started-with-telenest)
  - [Table of Contents](#table-of-contents)
  - [Installation](#installation)
  - [Quick Start: Bot API](#quick-start-bot-api)
    - [1. Get Your Bot Token](#1-get-your-bot-token)
    - [2. Configure the Module](#2-configure-the-module)
    - [3. Send Your First Message](#3-send-your-first-message)
    - [4. Handle Commands](#4-handle-commands)
  - [Quick Start: MTProto Client](#quick-start-mtproto-client)
    - [1. Get API Credentials](#1-get-api-credentials)
    - [2. Configure the Module](#2-configure-the-module-1)
    - [3. Login and Get Session](#3-login-and-get-session)
    - [4. Send Messages as Your Account](#4-send-messages-as-your-account)
  - [Using Both APIs Together](#using-both-apis-together)
  - [Next Steps](#next-steps)
    - [Bot API](#bot-api)
    - [MTProto Client](#mtproto-client)
    - [General](#general)
  - [Common Patterns](#common-patterns)
    - [Environment Variables Setup](#environment-variables-setup)
    - [Async Configuration with ConfigService](#async-configuration-with-configservice)
    - [Error Handling](#error-handling)
  - [Troubleshooting](#troubleshooting)
    - [Bot isn't responding](#bot-isnt-responding)
    - [MTProto login fails](#mtproto-login-fails)
    - [Import errors](#import-errors)
  - [Help \& Support](#help--support)

---

## Installation

Install the library and required NestJS peer dependencies:

```bash
npm i telenest @nestjs/common @nestjs/core reflect-metadata rxjs
```

Install **only the Telegram SDK(s) you need**. They are optional peer dependencies:

```bash
# For Bot API only (recommended for most users)
npm i telegraf

# For MTProto user-account client only
npm i telegram

# For both
npm i telegraf telegram
```

> **Tip:** Use subpath imports to load only what you need:
>
> - `telenest/bot` — Bot API only (no GramJS)
> - `telenest/client` — MTProto only (no Telegraf)
> - `telenest` — Both APIs

---

## Quick Start: Bot API

Build a traditional Telegram bot that responds to commands and messages.

### 1. Get Your Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the token (looks like `123456789:AAFooBarBaz...`)
4. Store it in `.env`:

```env
BOT_TOKEN=your_bot_token_here
```

### 2. Configure the Module

```typescript
// app.module.ts
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TelegramBotModule } from "telenest/bot";
import { AppService } from "./app.service";

@Module({
  imports: [
    ConfigModule.forRoot(),
    TelegramBotModule.forRoot({
      token: process.env.BOT_TOKEN!,
    }),
  ],
  providers: [AppService],
})
export class AppModule {}
```

### 3. Send Your First Message

```typescript
// app.service.ts
import { Injectable, OnModuleInit } from "@nestjs/common";
import { TelegramBotService } from "telenest/bot";

@Injectable()
export class AppService implements OnModuleInit {
  constructor(private readonly bot: TelegramBotService) {}

  async onModuleInit() {
    // Register /start command
    this.bot.start(async (ctx) => {
      await ctx.reply("Hello! I am your NestJS bot 🤖");
    });

    // Register /help command
    this.bot.help(async (ctx) => {
      await ctx.reply("Available commands:\n/start - Start the bot\n/hello - Say hello");
    });

    // Register custom command
    this.bot.command("hello", async (ctx) => {
      const name = ctx.from?.first_name || "friend";
      await ctx.reply(`Hello, ${name}! 👋`);
    });
  }
}
```

### 4. Handle Commands

Start your app:

```bash
npm run start:dev
```

Open Telegram and:

1. Find your bot by username
2. Send `/start`
3. Send `/hello`

**That's it!** Your bot is now running. See [BOT-API.md](./BOT-API.md) for complete documentation.

---

## Quick Start: MTProto Client

Control your own Telegram account programmatically.

> ⚠️ **Important:** This logs in as **your personal account**. Read Telegram's [Terms of Service](https://telegram.org/tos). Never spam or scrape. The session string grants full access—treat it like a password.

### 1. Get API Credentials

1. Go to <https://my.telegram.org>
2. Log in with your phone number
3. Click "API development tools"
4. Create an application
5. Copy `api_id` and `api_hash`
6. Store in `.env`:

```env
TG_API_ID=12345678
TG_API_HASH=abcdef1234567890abcdef1234567890
```

### 2. Configure the Module

```typescript
// app.module.ts
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TelegramClientModule } from "telenest/client";
import { AppService } from "./app.service";

@Module({
  imports: [
    ConfigModule.forRoot(),
    TelegramClientModule.forRoot({
      apiId: Number(process.env.TG_API_ID),
      apiHash: process.env.TG_API_HASH!,
      sessionString: process.env.TG_SESSION, // Optional: reuse existing session
    }),
  ],
  providers: [AppService],
})
export class AppModule {}
```

### 3. Login and Get Session

**Option A:** Use the built-in login CLI (recommended):

```bash
npm run login
```

Follow the prompts, then copy the session string to `.env` as `TG_SESSION`.

**Option B:** Login programmatically in your app:

```typescript
// app.service.ts
import { Injectable } from "@nestjs/common";
import { TelegramAuthService } from "telenest/client";

@Injectable()
export class AppService {
  constructor(private readonly auth: TelegramAuthService) {}

  async login() {
    // Send login code
    await this.auth.sendCode("+1234567890");

    // Sign in with the code you receive via Telegram
    const result = await this.auth.signIn("12345"); // code from Telegram

    if (result.status === "password-required") {
      // 2FA enabled: enter your password
      await this.auth.checkPassword("your2FApassword");
    }

    // Save session for later
    const session = this.auth.exportSession();
    console.log("Session:", session); // Save this to TG_SESSION
  }
}
```

### 4. Send Messages as Your Account

Once you have a valid `TG_SESSION`:

```typescript
// app.service.ts
import { Injectable, OnModuleInit } from "@nestjs/common";
import { TelegramUserService } from "telenest/client";

@Injectable()
export class AppService implements OnModuleInit {
  constructor(private readonly user: TelegramUserService) {}

  async onModuleInit() {
    // Get your own profile
    const me = await this.user.getMe();
    console.log("Logged in as:", me.firstName);

    // Send a message to yourself (Saved Messages)
    await this.user.sendToSelf("Hello from my NestJS app! 🚀");

    // Get your recent dialogs
    const dialogs = await this.user.getDialogs({ limit: 10 });
    console.log(
      "Recent chats:",
      dialogs.map((d) => d.title),
    );

    // Send a message to a chat
    await this.user.sendMessage("@username", "Hi from my account!");
  }
}
```

See [USER-CLIENT-MTPROTO.md](./USER-CLIENT-MTPROTO.md) for complete documentation.

---

## Using Both APIs Together

You can use both the Bot API and MTProto client in the same app:

```typescript
// app.module.ts
import { Module } from "@nestjs/common";
import { TelegramModule } from "telenest"; // Umbrella module

@Module({
  imports: [
    TelegramModule.forRoot({
      bot: {
        token: process.env.BOT_TOKEN!,
      },
      client: {
        apiId: Number(process.env.TG_API_ID),
        apiHash: process.env.TG_API_HASH!,
        sessionString: process.env.TG_SESSION,
      },
      isGlobal: true, // Make services available everywhere
    }),
  ],
})
export class AppModule {}
```

Then inject both services:

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramBotService } from "telenest/bot";
import { TelegramUserService } from "telenest/client";

@Injectable()
export class NotificationService {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly user: TelegramUserService,
  ) {}

  async notifyViaBot(chatId: number, message: string) {
    await this.bot.sendMessage(chatId, message);
  }

  async notifyMyself(message: string) {
    await this.user.sendToSelf(message);
  }
}
```

---

## Next Steps

Now that you're up and running, explore these guides:

### Bot API

- **[BOT-API.md](./BOT-API.md)** — Complete Bot API reference
- **[BOT-UPDATE-DECORATORS.md](./BOT-UPDATE-DECORATORS.md)** — Decorator-based handlers (`@TelegramUpdate`, `@Command`, etc.)
- **[MINI-APP-INIT-DATA.md](./MINI-APP-INIT-DATA.md)** — Validate Telegram Mini App data

### MTProto Client

- **[USER-CLIENT-MTPROTO.md](./USER-CLIENT-MTPROTO.md)** — Complete MTProto client reference
- **[AUTHENTICATION.md](./AUTHENTICATION.md)** — Authentication flow deep-dive

### General

- **[TESTING.md](./TESTING.md)** — How to test your bot/client code
- **[TELEGRAM-MODULE.md](./TELEGRAM-MODULE.md)** — Architecture overview
- **[examples/](../examples/)** — More complete examples

---

## Common Patterns

### Environment Variables Setup

```env
# Bot API
BOT_TOKEN=123456789:AAFooBarBaz...

# MTProto Client
TG_API_ID=12345678
TG_API_HASH=abcdef1234567890
TG_SESSION=1AgAOMT...  # Get this from `npm run login`
```

### Async Configuration with ConfigService

```typescript
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TelegramBotModule } from "telenest/bot";

@Module({
  imports: [
    ConfigModule.forRoot(),
    TelegramBotModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        token: config.get<string>("BOT_TOKEN")!,
      }),
    }),
  ],
})
export class AppModule {}
```

### Error Handling

```typescript
import { isTelegramError } from "telenest";

try {
  await bot.sendMessage(chatId, "Hello!");
} catch (error) {
  if (isTelegramError(error)) {
    console.error(`Telegram error [${error.kind}]:`, error.message);
    if (error.kind === "bot-api") {
      console.error("Status code:", error.statusCode);
    }
  } else {
    throw error; // Unexpected error
  }
}
```

---

## Troubleshooting

### Bot isn't responding

- Check that `BOT_TOKEN` is correct
- Make sure you started the bot in Telegram (send `/start`)
- Verify the app started without errors (`npm run start:dev`)

### MTProto login fails

- Verify `TG_API_ID` and `TG_API_HASH` are correct
- Check phone number format (include country code: `+1234567890`)
- If using an existing session, ensure it hasn't expired

### Import errors

- Make sure you installed the correct peer dependency:
  - Bot API needs `telegraf`
  - MTProto needs `telegram`
- Use subpath imports to avoid loading unused dependencies

---

## Help & Support

- 📖 [Full Documentation](./TELEGRAM-MODULE.md)
- 🐛 [GitHub Issues](https://github.com/Aborii/telenest/issues)
- 💬 Check existing docs in the [docs/](../docs/) folder

---

**Happy coding!** 🎉
