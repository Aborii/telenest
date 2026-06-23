# Examples & Recipes

Practical, copy-paste examples for common use cases with `nestjs-telegram`.

---

## Table of Contents

**Bot API Examples**

- [Simple Echo Bot](#simple-echo-bot)
- [Command Handler with Parameters](#command-handler-with-parameters)
- [Inline Keyboards & Callback Handling](#inline-keyboards--callback-handling)
- [Custom Reply Keyboard](#custom-reply-keyboard)
- [Sending Files & Media](#sending-files--media)
- [Photo Gallery (Media Group)](#photo-gallery-media-group)
- [Conversation State Machine](#conversation-state-machine)
- [Admin Commands](#admin-commands)
- [Webhook Mode](#webhook-mode)
- [Mini App Init Data Validation](#mini-app-init-data-validation)
- [Scheduled Messages](#scheduled-messages)

**MTProto Client Examples**

- [Login Flow](#login-flow)
- [Send Message to Saved Messages](#send-message-to-saved-messages)
- [List Recent Chats](#list-recent-chats)
- [Read Messages from a Channel](#read-messages-from-a-channel)
- [Listen to Incoming Messages](#listen-to-incoming-messages)
- [Auto-Reply Bot (User Account)](#auto-reply-bot-user-account)
- [Backup Chat History](#backup-chat-history)

**Hybrid Examples**

- [Bot + User Account Integration](#bot--user-account-integration)
- [Forward Bot Messages to Your Account](#forward-bot-messages-to-your-account)

**Testing Examples**

- [Unit Testing Bot Handlers](#unit-testing-bot-handlers)
- [Testing MTProto Services](#testing-mtproto-services)

---

## Bot API Examples

### Simple Echo Bot

Echoes every message the user sends.

```typescript
// echo.service.ts
import { Injectable } from "@nestjs/common";
import { TelegramBotService } from "nestjs-telegram/bot";

@Injectable()
export class EchoService {
  constructor(private readonly bot: TelegramBotService) {}

  async onModuleInit() {
    // Handle all text messages
    this.bot.on("text", async (ctx) => {
      const text = ctx.message.text;
      await ctx.reply(`You said: ${text}`);
    });
  }
}
```

**With Decorators:**

```typescript
// echo.update.ts
import { Injectable } from "@nestjs/common";
import { TelegramUpdate, On, Ctx, MessageText } from "nestjs-telegram/bot";
import type { Context } from "telegraf";

@TelegramUpdate()
@Injectable()
export class EchoUpdate {
  @On("text")
  async onText(@Ctx() ctx: Context, @MessageText() text: string) {
    await ctx.reply(`You said: ${text}`);
  }
}
```

---

### Command Handler with Parameters

Parse command arguments from user input.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramUpdate, Command, Ctx } from "nestjs-telegram/bot";
import type { Context } from "telegraf";

@TelegramUpdate()
@Injectable()
export class WeatherUpdate {
  @Command("weather")
  async getWeather(@Ctx() ctx: Context) {
    // Extract arguments: "/weather London" -> ["London"]
    const args = ctx.message.text.split(" ").slice(1);
    const city = args.join(" ") || "your location";

    // Simulate weather API call
    const weather = await this.fetchWeather(city);

    await ctx.reply(
      `🌤 Weather in ${city}:\n` + `Temperature: ${weather.temp}°C\n` + `Conditions: ${weather.conditions}`,
    );
  }

  private async fetchWeather(city: string) {
    // Your weather API logic here
    return { temp: 22, conditions: "Sunny" };
  }
}
```

---

### Inline Keyboards & Callback Handling

Interactive buttons under messages.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramUpdate, Command, Action, Ctx, CallbackData, InlineKeyboardBuilder } from "nestjs-telegram/bot";
import type { Context } from "telegraf";

@TelegramUpdate()
@Injectable()
export class MenuUpdate {
  @Command("menu")
  async showMenu(@Ctx() ctx: Context) {
    const keyboard = new InlineKeyboardBuilder()
      .callback("📊 Stats", "stats")
      .callback("⚙️ Settings", "settings")
      .row()
      .callback("ℹ️ Help", "help")
      .url("📖 Docs", "https://docs.example.com")
      .build();

    await ctx.reply("Choose an option:", { reply_markup: keyboard });
  }

  @Action("stats")
  async onStats(@Ctx() ctx: Context) {
    await ctx.answerCbQuery(); // Dismiss loading indicator
    await ctx.editMessageText("📊 Your stats:\n• Messages: 42\n• Active days: 7");
  }

  @Action("settings")
  async onSettings(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();

    const settingsKeyboard = new InlineKeyboardBuilder()
      .callback("🔔 Notifications: ON", "toggle_notif")
      .row()
      .callback("🌍 Language: EN", "change_lang")
      .row()
      .callback("« Back", "back_to_menu")
      .build();

    await ctx.editMessageText("⚙️ Settings", { reply_markup: settingsKeyboard });
  }

  @Action(/toggle_(.+)/)
  async onToggle(@Ctx() ctx: Context, @CallbackData() data: string) {
    const feature = ctx.match[1]; // 'notif'
    await ctx.answerCbQuery(`Toggled ${feature}!`);
    // Update state and refresh keyboard...
  }

  @Action("help")
  async onHelp(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await ctx.editMessageText("ℹ️ Help:\nUse /menu to see options");
  }
}
```

---

### Custom Reply Keyboard

Persistent buttons that send text.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramUpdate, Start, Hears, Ctx, ReplyKeyboardBuilder, removeKeyboard } from "nestjs-telegram/bot";
import type { Context } from "telegraf";

@TelegramUpdate()
@Injectable()
export class TaskUpdate {
  @Start()
  async onStart(@Ctx() ctx: Context) {
    const keyboard = new ReplyKeyboardBuilder()
      .text("📝 New Task")
      .text("✅ My Tasks")
      .row()
      .text("📊 Statistics")
      .text("⚙️ Settings")
      .resize()
      .build();

    await ctx.reply("Welcome! Choose an action:", { reply_markup: keyboard });
  }

  @Hears("📝 New Task")
  async onNewTask(@Ctx() ctx: Context) {
    await ctx.reply("Enter your task description:");
    // In production, use scenes/sessions to track conversation state
  }

  @Hears("✅ My Tasks")
  async onMyTasks(@Ctx() ctx: Context) {
    const tasks = ["Task 1", "Task 2", "Task 3"];
    await ctx.reply(`Your tasks:\n${tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}`);
  }

  @Hears("📊 Statistics")
  async onStats(@Ctx() ctx: Context) {
    await ctx.reply("📊 Total tasks: 12\n✅ Completed: 8\n⏳ Pending: 4");
  }

  @Command("hidekeyboard")
  async hideKeyboard(@Ctx() ctx: Context) {
    await ctx.reply("Keyboard hidden", { reply_markup: removeKeyboard() });
  }
}
```

---

### Sending Files & Media

Upload and send various file types.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramBotService } from "nestjs-telegram/bot";
import { createReadStream } from "fs";
import { Input } from "telegraf";

@Injectable()
export class MediaService {
  constructor(private readonly bot: TelegramBotService) {}

  async sendDocument(chatId: number) {
    // From file system
    await this.bot.sendDocument(
      chatId,
      {
        source: createReadStream("./report.pdf"),
        filename: "monthly-report.pdf",
      },
      {
        caption: "Here is your report",
      },
    );
  }

  async sendPhoto(chatId: number) {
    // From URL
    await this.bot.sendPhoto(chatId, "https://example.com/image.jpg", {
      caption: "Beautiful sunset 🌅",
    });

    // From Buffer
    const buffer = Buffer.from("...image data...");
    await this.bot.sendPhoto(chatId, { source: buffer });
  }

  async sendVideo(chatId: number) {
    await this.bot.sendVideo(
      chatId,
      {
        source: createReadStream("./video.mp4"),
      },
      {
        caption: "Check this out!",
        supports_streaming: true,
      },
    );
  }

  async sendVoice(chatId: number) {
    await this.bot.telegram.sendVoice(chatId, {
      source: createReadStream("./voice.ogg"),
    });
  }

  async sendLocation(chatId: number) {
    await this.bot.sendLocation(chatId, 51.5074, -0.1278); // London coordinates
  }
}
```

---

### Photo Gallery (Media Group)

Send multiple photos/videos as an album.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramBotService } from "nestjs-telegram/bot";

@Injectable()
export class GalleryService {
  constructor(private readonly bot: TelegramBotService) {}

  async sendGallery(chatId: number) {
    await this.bot.sendMediaGroup(chatId, [
      {
        type: "photo",
        media: "https://example.com/photo1.jpg",
        caption: "Photo 1",
      },
      {
        type: "photo",
        media: "https://example.com/photo2.jpg",
        caption: "Photo 2",
      },
      {
        type: "video",
        media: "https://example.com/video.mp4",
        caption: "Video",
      },
    ]);
  }
}
```

---

### Conversation State Machine

Multi-step conversation using sessions (requires `telegraf-session-local` or similar).

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramBotService } from "nestjs-telegram/bot";
import session from "telegraf-session-local";

interface SessionData {
  step?: "awaiting_name" | "awaiting_age";
  name?: string;
}

@Injectable()
export class RegistrationService {
  constructor(private readonly bot: TelegramBotService) {}

  onModuleInit() {
    // Enable sessions
    this.bot.use(session());

    this.bot.command("register", async (ctx) => {
      ctx.session.step = "awaiting_name";
      await ctx.reply("Welcome! What is your name?");
    });

    this.bot.on("text", async (ctx) => {
      const session = ctx.session as SessionData;

      if (session.step === "awaiting_name") {
        session.name = ctx.message.text;
        session.step = "awaiting_age";
        await ctx.reply(`Nice to meet you, ${session.name}! How old are you?`);
      } else if (session.step === "awaiting_age") {
        const age = parseInt(ctx.message.text);
        if (isNaN(age)) {
          await ctx.reply("Please enter a valid number.");
          return;
        }

        await ctx.reply(`Registration complete!\n` + `Name: ${session.name}\n` + `Age: ${age}`);

        // Clear session
        delete session.step;
        delete session.name;
      }
    });
  }
}
```

---

### Admin Commands

Restrict commands to specific users.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramUpdate, Command, Ctx, Sender } from "nestjs-telegram/bot";
import type { Context, User } from "telegraf";

@TelegramUpdate()
@Injectable()
export class AdminUpdate {
  private readonly adminIds = [123456789, 987654321]; // Your admin user IDs

  @Command("broadcast")
  async broadcast(@Ctx() ctx: Context, @Sender() from: User) {
    if (!this.isAdmin(from.id)) {
      await ctx.reply("⛔ This command is admin-only.");
      return;
    }

    const message = ctx.message.text.split(" ").slice(1).join(" ");
    if (!message) {
      await ctx.reply("Usage: /broadcast <message>");
      return;
    }

    // Send to all users (fetch from database)
    const userIds = await this.getAllUserIds();
    let sent = 0;

    for (const userId of userIds) {
      try {
        await ctx.telegram.sendMessage(userId, `📢 ${message}`);
        sent++;
      } catch (error) {
        console.error(`Failed to send to ${userId}:`, error);
      }
    }

    await ctx.reply(`✅ Broadcast sent to ${sent} users`);
  }

  @Command("stats")
  async stats(@Ctx() ctx: Context, @Sender() from: User) {
    if (!this.isAdmin(from.id)) {
      await ctx.reply("⛔ Admin only");
      return;
    }

    const stats = await this.getStats();
    await ctx.reply(
      `📊 Bot Statistics:\n` +
        `Total users: ${stats.totalUsers}\n` +
        `Active today: ${stats.activeToday}\n` +
        `Messages sent: ${stats.messagesSent}`,
    );
  }

  private isAdmin(userId: number): boolean {
    return this.adminIds.includes(userId);
  }

  private async getAllUserIds(): Promise<number[]> {
    // Fetch from your database
    return [111, 222, 333];
  }

  private async getStats() {
    // Fetch from your analytics
    return { totalUsers: 100, activeToday: 25, messagesSent: 1500 };
  }
}
```

---

### Webhook Mode

Run bot behind a web server instead of polling.

```typescript
// app.module.ts
import { Module } from "@nestjs/common";
import { TelegramBotModule } from "nestjs-telegram/bot";

@Module({
  imports: [
    TelegramBotModule.forRoot({
      token: process.env.BOT_TOKEN!,
      launch: false, // Don't auto-launch
      launchOptions: {
        webhook: {
          domain: "https://yourdomain.com",
          port: 3000,
        },
      },
    }),
  ],
})
export class AppModule {}

// bot.controller.ts
import { Controller, Post, Req } from "@nestjs/common";
import { TelegramBotService } from "nestjs-telegram/bot";
import type { Request } from "express";

@Controller("telegram")
export class BotController {
  constructor(private readonly bot: TelegramBotService) {}

  @Post("webhook")
  async handleWebhook(@Req() req: Request) {
    const callback = this.bot.webhookCallback("/telegram/webhook");
    await callback(req as any, undefined as any);
  }
}

// main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Set webhook
  const bot = app.get(TelegramBotService);
  await bot.telegram.setWebhook("https://yourdomain.com/telegram/webhook");

  await app.listen(3000);
}
```

---

### Mini App Init Data Validation

Validate data from Telegram Mini Apps.

```typescript
// auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { validateWebAppInitData } from "nestjs-telegram/bot";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class MiniAppGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const initData = request.headers["x-init-data"] || request.body.initData;

    if (!initData) {
      throw new UnauthorizedException("Missing init data");
    }

    const validated = validateWebAppInitData(initData, this.config.get("BOT_TOKEN")!, { maxAgeSeconds: 3600 });

    if (!validated) {
      throw new UnauthorizedException("Invalid init data");
    }

    // Attach user to request
    request.user = validated.user;
    return true;
  }
}

// mini-app.controller.ts
import { Controller, Post, UseGuards, Req } from "@nestjs/common";
import { MiniAppGuard } from "./auth.guard";

@Controller("api")
export class MiniAppController {
  @Post("submit")
  @UseGuards(MiniAppGuard)
  async handleSubmit(@Req() req) {
    const user = req.user; // Validated Telegram user
    console.log("Request from:", user.id, user.username);

    return { success: true, userId: user.id };
  }
}
```

---

### Scheduled Messages

Send messages at specific times.

```typescript
import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { TelegramBotService } from "nestjs-telegram/bot";

@Injectable()
export class SchedulerService {
  constructor(private readonly bot: TelegramBotService) {}

  // Every day at 9 AM
  @Cron("0 9 * * *")
  async sendDailyReminder() {
    const subscribers = await this.getSubscribers();

    for (const chatId of subscribers) {
      await this.bot.sendMessage(chatId, "🌅 Good morning! Don't forget to check your tasks today.");
    }
  }

  // Every hour
  @Cron(CronExpression.EVERY_HOUR)
  async sendHourlyUpdate() {
    const adminChat = 123456789;
    await this.bot.sendMessage(adminChat, "⏰ Hourly system check: All OK");
  }

  private async getSubscribers(): Promise<number[]> {
    // Fetch from database
    return [111111, 222222, 333333];
  }
}
```

---

## MTProto Client Examples

### Login Flow

Complete authentication process.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramAuthService } from "nestjs-telegram/client";

@Injectable()
export class AuthService {
  constructor(private readonly auth: TelegramAuthService) {}

  async login(phone: string, code?: string, password?: string) {
    // Step 1: Send code
    if (!code) {
      await this.auth.sendCode(phone);
      return { status: "code_sent", message: "Check Telegram for your code" };
    }

    // Step 2: Sign in with code
    const result = await this.auth.signIn(code);

    if (result.status === "authorized") {
      const session = this.auth.exportSession();
      return {
        status: "success",
        user: result.user,
        session, // Save this!
      };
    }

    // Step 3: Handle 2FA
    if (result.status === "password-required") {
      if (!password) {
        return { status: "2fa_required", message: "Enter your 2FA password" };
      }

      const user = await this.auth.checkPassword(password);
      const session = this.auth.exportSession();

      return { status: "success", user, session };
    }
  }
}
```

---

### Send Message to Saved Messages

Quick note-taking to yourself.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramUserService } from "nestjs-telegram/client";

@Injectable()
export class NotesService {
  constructor(private readonly user: TelegramUserService) {}

  async saveNote(text: string) {
    await this.user.sendToSelf(`📝 Note: ${text}\n\n${new Date().toLocaleString()}`);
  }

  async saveWithTags(text: string, tags: string[]) {
    const tagString = tags.map((t) => `#${t}`).join(" ");
    await this.user.sendToSelf(`${text}\n\n${tagString}`);
  }
}
```

---

### List Recent Chats

Get your dialog list.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramUserService } from "nestjs-telegram/client";

@Injectable()
export class ChatsService {
  constructor(private readonly user: TelegramUserService) {}

  async listRecentChats() {
    const dialogs = await this.user.getDialogs({ limit: 20 });

    return dialogs.map((dialog) => ({
      id: dialog.id,
      title: dialog.title,
      unread: dialog.unreadCount,
      isPinned: dialog.isPinned,
      lastMessage: dialog.lastMessage?.text,
      lastMessageDate: dialog.lastMessage?.date,
    }));
  }

  async findChatByTitle(title: string) {
    const dialogs = await this.user.getDialogs({ limit: 100 });
    return dialogs.find((d) => d.title.toLowerCase().includes(title.toLowerCase()));
  }

  async getUnreadCount() {
    const dialogs = await this.user.getDialogs({ limit: 100 });
    return dialogs.reduce((sum, d) => sum + d.unreadCount, 0);
  }
}
```

---

### Read Messages from a Channel

Fetch recent messages from a channel or group.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramUserService } from "nestjs-telegram/client";

@Injectable()
export class ChannelReaderService {
  constructor(private readonly user: TelegramUserService) {}

  async readLatestPosts(channelUsername: string, limit = 10) {
    const messages = await this.user.getMessages(`@${channelUsername}`, { limit });

    return messages.map((msg) => ({
      id: msg.id,
      text: msg.text,
      date: msg.date,
      views: msg.views,
      forwards: msg.forwards,
    }));
  }

  async searchInChannel(channelUsername: string, keyword: string) {
    const messages = await this.user.getMessages(`@${channelUsername}`, { limit: 100 });
    return messages.filter((msg) => msg.text?.toLowerCase().includes(keyword.toLowerCase()));
  }
}
```

---

### Listen to Incoming Messages

React to messages in real-time.

```typescript
import { Injectable, OnModuleInit } from "@nestjs/common";
import { TelegramUserService } from "nestjs-telegram/client";

@Injectable()
export class MessageListenerService implements OnModuleInit {
  constructor(private readonly user: TelegramUserService) {}

  onModuleInit() {
    this.user.updates$.subscribe(async (message) => {
      console.log("New message:", {
        from: message.sender?.username,
        text: message.text,
        chat: message.chatId,
      });

      // Auto-reply to specific keywords
      if (message.text?.toLowerCase().includes("urgent")) {
        await this.user.sendMessage(message.chatId, "Got your urgent message!");
      }
    });
  }
}
```

---

### Auto-Reply Bot (User Account)

Automated responses from your account (use responsibly!).

```typescript
import { Injectable, OnModuleInit } from "@nestjs/common";
import { TelegramUserService } from "nestjs-telegram/client";

@Injectable()
export class AutoReplyService implements OnModuleInit {
  private enabled = false;
  private awayMessage = "🤖 Auto-reply: I'm currently away. Will respond soon!";

  constructor(private readonly user: TelegramUserService) {}

  onModuleInit() {
    this.user.updates$.subscribe(async (message) => {
      // Only reply to incoming messages (not your own)
      if (message.isOutgoing || !this.enabled) return;

      // Don't reply to groups/channels
      const dialogs = await this.user.getDialogs({ limit: 1 });
      const dialog = dialogs.find((d) => d.id === message.chatId);
      if (dialog?.isGroup || dialog?.isChannel) return;

      // Send auto-reply
      await this.user.sendMessage(message.chatId, this.awayMessage);
    });
  }

  enableAutoReply(message?: string) {
    this.enabled = true;
    if (message) this.awayMessage = message;
  }

  disableAutoReply() {
    this.enabled = false;
  }
}
```

---

### Backup Chat History

Export messages to JSON.

```typescript
import { Injectable } from "@nestjs/common";
import { TelegramUserService } from "nestjs-telegram/client";
import { writeFile } from "fs/promises";

@Injectable()
export class BackupService {
  constructor(private readonly user: TelegramUserService) {}

  async backupChat(chatUsername: string, outputPath: string) {
    const messages = await this.user.getMessages(`@${chatUsername}`, { limit: 1000 });

    const backup = {
      chat: chatUsername,
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages.map((msg) => ({
        id: msg.id,
        date: msg.date.toISOString(),
        sender: msg.sender?.username || msg.sender?.firstName,
        text: msg.text,
        mediaType: msg.mediaType,
      })),
    };

    await writeFile(outputPath, JSON.stringify(backup, null, 2));
    return backup.messageCount;
  }

  async backupAllChats() {
    const dialogs = await this.user.getDialogs({ limit: 50 });

    for (const dialog of dialogs) {
      if (dialog.isUser) {
        const filename = `backup_${dialog.id}.json`;
        await this.backupChat(dialog.id, filename);
        console.log(`Backed up ${dialog.title} to ${filename}`);
      }
    }
  }
}
```

---

## Hybrid Examples

### Bot + User Account Integration

Use both APIs together.

```typescript
// app.module.ts
import { Module } from "@nestjs/common";
import { TelegramModule } from "nestjs-telegram";
import { BridgeService } from "./bridge.service";

@Module({
  imports: [
    TelegramModule.forRoot({
      bot: { token: process.env.BOT_TOKEN! },
      client: {
        apiId: Number(process.env.TG_API_ID),
        apiHash: process.env.TG_API_HASH!,
        sessionString: process.env.TG_SESSION,
      },
      isGlobal: true,
    }),
  ],
  providers: [BridgeService],
})
export class AppModule {}

// bridge.service.ts
import { Injectable, OnModuleInit } from "@nestjs/common";
import { TelegramBotService } from "nestjs-telegram/bot";
import { TelegramUserService } from "nestjs-telegram/client";

@Injectable()
export class BridgeService implements OnModuleInit {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly user: TelegramUserService,
  ) {}

  onModuleInit() {
    // Bot command to send message from your account
    this.bot.command("sendas", async (ctx) => {
      const [target, ...messageParts] = ctx.message.text.split(" ").slice(1);
      const message = messageParts.join(" ");

      if (!target || !message) {
        await ctx.reply("Usage: /sendas <@username> <message>");
        return;
      }

      try {
        await this.user.sendMessage(target, message);
        await ctx.reply(`✅ Sent as your account to ${target}`);
      } catch (error) {
        await ctx.reply(`❌ Failed: ${error.message}`);
      }
    });

    // Forward user account messages to bot users
    this.user.updates$.subscribe(async (msg) => {
      if (msg.text?.startsWith("/bot ")) {
        const adminChatId = 123456789; // Your bot admin chat
        await this.bot.sendMessage(adminChatId, `📨 From ${msg.sender?.username}: ${msg.text.slice(5)}`);
      }
    });
  }
}
```

---

### Forward Bot Messages to Your Account

Mirror bot interactions to yourself.

```typescript
import { Injectable, OnModuleInit } from "@nestjs/common";
import { TelegramBotService } from "nestjs-telegram/bot";
import { TelegramUserService } from "nestjs-telegram/client";

@Injectable()
export class MirrorService implements OnModuleInit {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly user: TelegramUserService,
  ) {}

  onModuleInit() {
    // Log all bot interactions to your Saved Messages
    this.bot.use(async (ctx, next) => {
      const from = ctx.from;
      const text = ctx.message?.text || ctx.callbackQuery?.data || "unknown";

      await this.user.sendToSelf(
        `🤖 Bot activity:\n` +
          `User: ${from?.username || from?.id}\n` +
          `Message: ${text}\n` +
          `Time: ${new Date().toLocaleString()}`,
      );

      return next();
    });
  }
}
```

---

## Testing Examples

### Unit Testing Bot Handlers

Test without hitting Telegram servers.

```typescript
// echo.update.spec.ts
import { Test } from "@nestjs/testing";
import { TelegramBotService } from "nestjs-telegram/bot";
import { EchoUpdate } from "./echo.update";
import type { Context } from "telegraf";

describe("EchoUpdate", () => {
  let update: EchoUpdate;
  let bot: TelegramBotService;

  beforeEach(async () => {
    const mockBot = {
      on: jest.fn(),
      sendMessage: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [EchoUpdate, { provide: TelegramBotService, useValue: mockBot }],
    }).compile();

    update = module.get(EchoUpdate);
    bot = module.get(TelegramBotService);
  });

  it("should echo user message", async () => {
    const mockCtx = {
      message: { text: "Hello!" },
      reply: jest.fn(),
    } as any as Context;

    await update.onText(mockCtx, "Hello!");

    expect(mockCtx.reply).toHaveBeenCalledWith("You said: Hello!");
  });
});
```

---

### Testing MTProto Services

Mock `IGramClient` for offline tests.

```typescript
// chat.service.spec.ts
import { Test } from "@nestjs/testing";
import { TelegramUserService } from "nestjs-telegram/client";
import { TELEGRAM_GRAM_CLIENT } from "nestjs-telegram/client";
import type { IGramClient } from "nestjs-telegram/client";

describe("ChatsService", () => {
  let service: TelegramUserService;
  let mockClient: jest.Mocked<IGramClient>;

  beforeEach(async () => {
    mockClient = {
      isConnected: jest.fn().mockReturnValue(true),
      getDialogs: jest.fn().mockResolvedValue([
        {
          id: "1",
          title: "Test Chat",
          unreadCount: 5,
          isPinned: false,
        },
      ]),
      sendMessage: jest.fn(),
      getMe: jest.fn(),
      getMessages: jest.fn(),
      onNewMessage: jest.fn(() => () => {}),
    } as any;

    const module = await Test.createTestingModule({
      providers: [TelegramUserService, { provide: TELEGRAM_GRAM_CLIENT, useValue: mockClient }],
    }).compile();

    service = module.get(TelegramUserService);
  });

  it("should fetch dialogs", async () => {
    const dialogs = await service.getDialogs({ limit: 10 });

    expect(mockClient.getDialogs).toHaveBeenCalledWith({ limit: 10 });
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].title).toBe("Test Chat");
  });
});
```

---

**For more examples, see:**

- [examples/](../examples/) folder
- [docs/BOT-API.md](./BOT-API.md)
- [docs/USER-CLIENT-MTPROTO.md](./USER-CLIENT-MTPROTO.md)
- [docs/TESTING.md](./TESTING.md)
