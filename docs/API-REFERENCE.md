# API Reference

Complete reference for all public APIs, classes, interfaces, and types in `nestjs-telegram`.

---

## Table of Contents

- [Bot API](#bot-api)
  - [TelegramBotModule](#telegrambotmodule)
  - [TelegramBotService](#telegrambotservice)
  - [Keyboard Builders](#keyboard-builders)
  - [Update Decorators](#update-decorators)
  - [Mini App Validation](#mini-app-validation)
- [MTProto Client](#mtproto-client)
  - [TelegramClientModule](#telegramclientmodule)
  - [TelegramAuthService](#telegramauthservice)
  - [TelegramUserService](#telegramuserservice)
  - [Session Stores](#session-stores)
  - [DTOs & Types](#dtos--types)
- [Common](#common)
  - [Error Hierarchy](#error-hierarchy)
  - [Shared Types](#shared-types)
- [Umbrella Module](#umbrella-module)

---

## Bot API

### TelegramBotModule

Dynamic module for registering the Bot API side.

#### Static Methods

##### `forRoot(options: TelegramBotModuleOptions): DynamicModule`

Synchronous configuration. Use when options are available at import time.

**Parameters:**
- `options.token` (string, **required**) — Bot token from @BotFather
- `options.launch` (boolean, optional, default: `true`) — Auto-launch on bootstrap
- `options.launchOptions` (object, optional) — Telegraf launch config (webhook, etc.)

**Example:**
```typescript
TelegramBotModule.forRoot({
  token: process.env.BOT_TOKEN!,
  launch: true,
})
```

##### `forRootAsync(options: TelegramBotModuleAsyncOptions): DynamicModule`

Async configuration with `useFactory`, `useClass`, or `useExisting`.

**Example:**
```typescript
TelegramBotModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    token: config.get('BOT_TOKEN')!,
  }),
})
```

---

### TelegramBotService

Injectable facade over Telegraf. All methods wrap errors in `TelegramBotApiError`.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `instance` | `Telegraf` | Raw Telegraf instance for advanced use |
| `telegram` | `Telegram` | Raw Telegraf Bot API client |

#### Lifecycle Methods

##### `launch(): Promise<void>`

Starts the bot manually (only needed if `launch: false`).

**Throws:** Never (logs errors)

##### `stop(reason?: string): void`

Stops the bot.

**Parameters:**
- `reason` (string, optional) — Logged reason for shutdown

---

#### Messaging Methods

##### `sendMessage(chatId, text, extra?): Promise<Message>`

Sends a text message.

**Parameters:**
- `chatId` (number | string) — Target chat ID or username
- `text` (string) — Message text
- `extra` (object, optional) — Additional options (parse mode, keyboard, etc.)

**Returns:** The sent `Message` object

**Throws:** `TelegramBotApiError`

**Example:**
```typescript
await bot.sendMessage(123456, 'Hello!', {
  parse_mode: 'Markdown',
  reply_markup: { inline_keyboard: [[{ text: 'Click me', callback_data: 'btn1' }]] }
});
```

##### `sendPhoto(chatId, photo, extra?): Promise<Message>`

Sends a photo.

**Parameters:**
- `chatId` — Target chat
- `photo` — Photo source (file path, Buffer, Stream, or URL)
- `extra` — Optional caption, keyboard, etc.

**Example:**
```typescript
await bot.sendPhoto(chatId, 'https://example.com/image.jpg', {
  caption: 'Check this out!'
});
```

##### `sendDocument(chatId, document, extra?): Promise<Message>`

Sends a file/document.

**Example:**
```typescript
import { createReadStream } from 'fs';
await bot.sendDocument(chatId, { source: createReadStream('./file.pdf') });
```

##### `sendVideo(chatId, video, extra?): Promise<Message>`

Sends a video.

##### `sendAudio(chatId, audio, extra?): Promise<Message>`

Sends an audio file.

##### `sendMediaGroup(chatId, media, extra?): Promise<Message[]>`

Sends multiple photos/videos as an album.

**Example:**
```typescript
await bot.sendMediaGroup(chatId, [
  { type: 'photo', media: 'https://example.com/1.jpg' },
  { type: 'photo', media: 'https://example.com/2.jpg' },
]);
```

##### `sendLocation(chatId, latitude, longitude, extra?): Promise<Message>`

Sends a location.

##### `sendChatAction(chatId, action): Promise<true>`

Shows typing indicator or upload status.

**Parameters:**
- `action` — `'typing'`, `'upload_photo'`, `'upload_video'`, etc.

**Example:**
```typescript
await bot.sendChatAction(chatId, 'typing');
await new Promise(r => setTimeout(r, 2000)); // Simulate typing
await bot.sendMessage(chatId, 'Done!');
```

##### `forwardMessage(chatId, fromChatId, messageId, extra?): Promise<Message>`

Forwards a message.

##### `copyMessage(chatId, fromChatId, messageId, extra?): Promise<MessageId>`

Copies a message without "Forwarded from" header.

---

#### Editing & Deletion

##### `editMessageText(chatId, messageId, inlineMessageId, text, extra?): Promise<Message | true>`

Edits message text.

**Example:**
```typescript
const msg = await bot.sendMessage(chatId, 'Loading...');
await bot.editMessageText(chatId, msg.message_id, undefined, 'Done!');
```

##### `editMessageReplyMarkup(chatId, messageId, inlineMessageId, markup): Promise<Message | true>`

Updates inline keyboard.

##### `deleteMessage(chatId, messageId): Promise<true>`

Deletes a message.

---

#### Callback Queries

##### `answerCbQuery(callbackQueryId, text?, showAlert?, extra?): Promise<true>`

Answers an inline button press.

**Parameters:**
- `callbackQueryId` — From `ctx.callbackQuery.id`
- `text` — Optional notification text
- `showAlert` — Show as alert instead of notification

**Example:**
```typescript
bot.action('confirm', async (ctx) => {
  await bot.answerCbQuery(ctx.callbackQuery.id, 'Confirmed!');
  await ctx.editMessageText('Action confirmed ✅');
});
```

---

#### Chat & Member Management

##### `getMe(): Promise<User>`

Returns bot's own profile.

##### `getChat(chatId): Promise<Chat>`

Gets chat info.

##### `getChatMembersCount(chatId): Promise<number>`

Returns member count (deprecated: use `getChatMemberCount`).

##### `getChatMemberCount(chatId): Promise<number>`

Returns member count.

##### `banChatMember(chatId, userId, untilDate?, extra?): Promise<true>`

Bans a user from a chat.

##### `unbanChatMember(chatId, userId, extra?): Promise<true>`

Unbans a user.

##### `pinChatMessage(chatId, messageId, extra?): Promise<true>`

Pins a message.

##### `unpinChatMessage(chatId, messageId?): Promise<true>`

Unpins a message.

---

#### Commands

##### `setMyCommands(commands, extra?): Promise<true>`

Sets bot's command menu.

**Example:**
```typescript
await bot.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'help', description: 'Show help' },
]);
```

##### `getMyCommands(extra?): Promise<BotCommand[]>`

Gets current commands.

##### `deleteMyCommands(extra?): Promise<true>`

Removes all commands.

---

#### Files

##### `getFile(fileId): Promise<File>`

Gets file metadata.

##### `getFileLink(fileId): Promise<URL>`

Gets download URL for a file.

**Example:**
```typescript
const file = await bot.getFile(fileId);
const url = await bot.getFileLink(fileId);
console.log('Download:', url.href);
```

---

#### Webhooks

##### `setWebhook(url, extra?): Promise<true>`

Configures webhook endpoint.

##### `deleteWebhook(extra?): Promise<true>`

Removes webhook (switches to polling).

##### `getWebhookInfo(): Promise<WebhookInfo>`

Returns webhook status.

##### `webhookCallback(path?): WebhookCallback`

Express/Koa middleware for webhook handling.

---

#### Handler Registration

##### `start(...middleware): Telegraf`

Registers `/start` handler.

**Example:**
```typescript
bot.start((ctx) => ctx.reply('Welcome!'));
```

##### `help(...middleware): Telegraf`

Registers `/help` handler.

##### `command(command, ...middleware): Telegraf`

Registers custom command(s).

**Example:**
```typescript
bot.command('ping', (ctx) => ctx.reply('pong'));
bot.command(['stats', 'info'], handlerFunction);
```

##### `hears(triggers, ...middleware): Telegraf`

Matches message text.

**Example:**
```typescript
bot.hears('hello', (ctx) => ctx.reply('Hi!'));
bot.hears(/^\/secret (\w+)$/, (ctx) => {
  const code = ctx.match[1];
  // ...
});
```

##### `action(triggers, ...middleware): Telegraf`

Handles inline button callbacks.

**Example:**
```typescript
bot.action('delete', async (ctx) => {
  await ctx.deleteMessage();
  await ctx.answerCbQuery('Deleted!');
});
```

##### `on(updateType, ...middleware): Telegraf`

Handles specific update types.

**Example:**
```typescript
bot.on('text', (ctx) => ctx.reply(`You said: ${ctx.text}`));
bot.on('photo', (ctx) => ctx.reply('Nice photo!'));
```

##### `use(...middleware): Telegraf`

Registers global middleware.

**Example:**
```typescript
bot.use((ctx, next) => {
  console.log('Update:', ctx.updateType);
  return next();
});
```

##### `catch(handler): void`

Registers global error handler.

**Example:**
```typescript
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('Something went wrong!');
});
```

---

### Keyboard Builders

Fluent builders for inline and reply keyboards.

#### InlineKeyboardBuilder

Builds inline keyboards (buttons under messages).

**Methods:**

##### `callback(text: string, data: string): this`

Adds a callback button.

##### `url(text: string, url: string): this`

Adds a URL button.

##### `switchToChat(text: string, query: string): this`

Adds a "switch to chat" button.

##### `game(text: string): this`

Adds a game button.

##### `pay(text: string): this`

Adds a payment button.

##### `row(): this`

Starts a new row.

##### `build(): InlineKeyboardMarkup`

Returns the final keyboard.

**Example:**
```typescript
import { InlineKeyboardBuilder } from 'nestjs-telegram/bot';

const keyboard = new InlineKeyboardBuilder()
  .callback('Yes', 'confirm')
  .callback('No', 'cancel')
  .row()
  .url('Learn more', 'https://example.com')
  .build();

await bot.sendMessage(chatId, 'Are you sure?', { reply_markup: keyboard });
```

---

#### ReplyKeyboardBuilder

Builds custom reply keyboards (buttons that send text).

**Methods:**

##### `text(text: string, request?: RequestContact | RequestLocation): this`

Adds a text button.

##### `requestContact(text: string): this`

Button that shares user's contact.

##### `requestLocation(text: string): this`

Button that shares location.

##### `requestPoll(text: string, type?: 'quiz' | 'regular'): this`

Button that creates a poll.

##### `row(): this`

Starts a new row.

##### `resize(resize: boolean = true): this`

Auto-resize keyboard.

##### `oneTime(oneTime: boolean = true): this`

Hide keyboard after one use.

##### `selective(selective: boolean = true): this`

Show only to mentioned users.

##### `placeholder(placeholder: string): this`

Input field placeholder.

##### `build(): ReplyKeyboardMarkup`

Returns the final keyboard.

**Example:**
```typescript
import { ReplyKeyboardBuilder } from 'nestjs-telegram/bot';

const keyboard = new ReplyKeyboardBuilder()
  .text('📝 New Task')
  .text('📊 Stats')
  .row()
  .text('⚙️ Settings')
  .resize()
  .oneTime()
  .build();

await bot.sendMessage(chatId, 'Choose an action:', { reply_markup: keyboard });
```

---

#### Helpers

##### `removeKeyboard(selective?: boolean): ReplyKeyboardRemove`

Removes the custom keyboard.

**Example:**
```typescript
import { removeKeyboard } from 'nestjs-telegram/bot';
await bot.sendMessage(chatId, 'Keyboard hidden', { reply_markup: removeKeyboard() });
```

##### `forceReply(selective?: boolean, placeholder?: string): ForceReply`

Forces user to reply.

---

### Update Decorators

Decorator-based handler registration (alternative to imperative style).

#### Class Decorator

##### `@TelegramUpdate()`

Marks a class for automatic handler registration.

**Example:**
```typescript
import { TelegramUpdate, Start, Command, Ctx } from 'nestjs-telegram/bot';
import { Injectable } from '@nestjs/common';
import type { Context } from 'telegraf';

@TelegramUpdate()
@Injectable()
export class BotHandlers {
  @Start()
  async onStart(@Ctx() ctx: Context) {
    await ctx.reply('Bot started!');
  }

  @Command('ping')
  async onPing(@Ctx() ctx: Context) {
    await ctx.reply('pong');
  }
}
```

---

#### Method Decorators

##### `@Start()`
Handles `/start`.

##### `@Help()`
Handles `/help`.

##### `@Command(command: string | string[])`
Handles custom command(s).

##### `@Hears(trigger: string | RegExp | (string | RegExp)[])`
Matches message text.

##### `@Action(trigger: string | RegExp | (string | RegExp)[])`
Handles callback queries.

##### `@On(updateType: UpdateType | UpdateType[])`
Handles specific update types.

**Example:**
```typescript
@On('photo')
async onPhoto(@Ctx() ctx: Context) {
  await ctx.reply('Nice photo!');
}
```

##### `@Use()`
Global middleware (runs for all updates).

---

#### Parameter Decorators

Inject context data into handler methods.

##### `@Ctx()`
Injects full Telegraf `Context`.

##### `@MessageText()`
Injects `ctx.message.text`.

##### `@Sender()`
Injects `ctx.from` (User object).

##### `@CallbackData()`
Injects `ctx.callbackQuery.data`.

**Example:**
```typescript
@Command('greet')
async greet(
  @Ctx() ctx: Context,
  @Sender() from: User,
  @MessageText() text: string,
) {
  await ctx.reply(`Hello ${from.first_name}! You said: ${text}`);
}
```

See [BOT-UPDATE-DECORATORS.md](./BOT-UPDATE-DECORATORS.md) for full details.

---

### Mini App Validation

##### `validateWebAppInitData(initData: string, botToken: string, options?): WebAppInitData | null`

Validates Telegram Mini App init data signature.

**Parameters:**
- `initData` — Query string from `window.Telegram.WebApp.initData`
- `botToken` — Your bot token
- `options.maxAgeSeconds` — Reject data older than this

**Returns:** Parsed data or `null` if signature invalid

**Throws:** `TelegramConfigError` for malformed data

**Example:**
```typescript
import { validateWebAppInitData } from 'nestjs-telegram/bot';

const data = validateWebAppInitData(req.body.initData, process.env.BOT_TOKEN!, {
  maxAgeSeconds: 3600,
});

if (!data) throw new UnauthorizedException('Invalid init data');

console.log('User:', data.user?.id, data.user?.username);
```

See [MINI-APP-INIT-DATA.md](./MINI-APP-INIT-DATA.md) for details.

---

## MTProto Client

### TelegramClientModule

Dynamic module for the MTProto user-account side.

#### Static Methods

##### `forRoot(options: TelegramClientModuleOptions): DynamicModule`

**Required Options:**
- `apiId` (number) — From my.telegram.org
- `apiHash` (string) — From my.telegram.org

**Optional Options:**
- `sessionString` (string) — Reuse existing session
- `sessionStore` (SessionStore) — Custom persistence (default: in-memory)
- `autoConnect` (boolean, default: `true`) — Auto-connect on bootstrap
- `deviceModel` (string) — Device name shown in "Active sessions"
- `appVersion` (string) — App version
- `clientFactory` (function) — Custom client factory (for testing)

**Example:**
```typescript
TelegramClientModule.forRoot({
  apiId: Number(process.env.TG_API_ID),
  apiHash: process.env.TG_API_HASH!,
  sessionString: process.env.TG_SESSION,
})
```

##### `forRootAsync(options: TelegramClientModuleAsyncOptions): DynamicModule`

Async configuration.

**Example:**
```typescript
TelegramClientModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    apiId: config.get('TG_API_ID')!,
    apiHash: config.get('TG_API_HASH')!,
    sessionString: config.get('TG_SESSION'),
  }),
})
```

---

### TelegramAuthService

Handles MTProto authentication.

#### Methods

##### `sendCode(phoneNumber: string, forceSMS?: boolean): Promise<GramSendCodeResult>`

Sends login code to phone number.

**Parameters:**
- `phoneNumber` — Format: `+12345678901` (include country code)
- `forceSMS` — Force SMS instead of Telegram message

**Returns:**
```typescript
{
  phoneCodeHash: string; // Save this for signIn
  isCodeViaSms: boolean;
}
```

**Throws:** `TelegramAuthError`

##### `signIn(phoneCode: string): Promise<GramSignInResult>`

Signs in with the received code.

**Returns:**
```typescript
// Success
{ status: 'authorized'; user: GramUser; }

// 2FA required
{ status: 'password-required'; }
```

**Throws:** `TelegramAuthError` (codes: `CODE_INVALID`, `CODE_NOT_REQUESTED`, etc.)

##### `checkPassword(password: string): Promise<GramUser>`

Completes 2FA login.

**Throws:** `TelegramAuthError` with code `PASSWORD_INVALID` if wrong

##### `isAuthorized(): Promise<boolean>`

Checks if currently signed in.

##### `logOut(): Promise<void>`

Signs out and clears session.

##### `exportSession(): string`

Returns session string (save as `TG_SESSION`).

**Example: Complete Login Flow**
```typescript
// 1. Send code
const { phoneCodeHash } = await auth.sendCode('+12345678901');

// 2. Sign in
const result = await auth.signIn('12345'); // code from Telegram

if (result.status === 'password-required') {
  // 3. Handle 2FA
  await auth.checkPassword('my2FApassword');
}

// 4. Save session
const session = auth.exportSession();
console.log('Save this:', session);
```

---

### TelegramUserService

Operations performed as your account.

#### Properties

##### `updates$: Observable<GramMessage>`

Hot stream of incoming messages.

**Example:**
```typescript
user.updates$.subscribe((msg) => {
  console.log('New message:', msg.text, 'from', msg.sender?.firstName);
});
```

---

#### Methods

##### `getMe(): Promise<GramUser>`

Returns your own profile.

**Example:**
```typescript
const me = await user.getMe();
console.log(me.firstName, me.isPremium);
```

##### `getDialogs(params?: GramGetDialogsParams): Promise<GramDialog[]>`

Lists your chats.

**Parameters:**
```typescript
{
  limit?: number;        // Max dialogs to fetch (default: 100)
  offsetDate?: number;   // Unix timestamp for pagination
  offsetId?: number;     // Message ID for pagination
  offsetPeer?: GramPeer; // Peer for pagination
  archived?: boolean;    // Fetch archived chats only
}
```

**Returns:** Array of `GramDialog` objects (most recent first)

**Example:**
```typescript
const chats = await user.getDialogs({ limit: 20 });
chats.forEach(chat => {
  console.log(chat.title, chat.unreadCount, chat.lastMessage?.text);
});
```

##### `getMessages(peer: GramPeer, params?: GramGetMessagesParams): Promise<GramMessage[]>`

Fetches messages from a chat.

**Parameters:**
- `peer` — `'me'` (Saved Messages), `@username`, or numeric ID
- `params.limit` — Max messages (default: 100)
- `params.offsetId` — Message ID to start from
- `params.minId`, `maxId` — ID range
- `params.addOffset` — Skip messages

**Returns:** Array of `GramMessage` (newest first)

**Example:**
```typescript
const messages = await user.getMessages('@durov', { limit: 50 });
messages.forEach(msg => {
  console.log(msg.date, msg.sender?.username, msg.text);
});
```

##### `sendMessage(peer: GramPeer, text: string | GramSendMessageParams): Promise<GramMessage>`

Sends a message as your account.

**Parameters:**
- `peer` — Target (`'me'`, `@username`, or ID)
- `text` — String or full params object

**GramSendMessageParams:**
```typescript
{
  message: string;
  parseMode?: 'markdown' | 'html';
  linkPreview?: boolean;
  silent?: boolean;
  scheduleDate?: number; // Unix timestamp
  replyTo?: number;      // Message ID to reply to
}
```

**Example:**
```typescript
// Simple
await user.sendMessage('me', 'Note to self');

// With options
await user.sendMessage('@channel', {
  message: '<b>Bold text</b>',
  parseMode: 'html',
  silent: true,
});
```

##### `sendToSelf(text: string): Promise<GramMessage>`

Convenience for sending to Saved Messages.

---

### Session Stores

Pluggable session persistence via the `SessionStore` interface.

#### SessionStore Interface

```typescript
interface SessionStore {
  load(): Promise<string | null>;
  save(session: string): Promise<void>;
  clear(): Promise<void>;
}
```

---

#### InMemorySessionStore

Volatile, in-memory storage (lost on restart).

**Example:**
```typescript
import { InMemorySessionStore } from 'nestjs-telegram/client';

TelegramClientModule.forRoot({
  apiId: 12345,
  apiHash: 'abc',
  sessionStore: new InMemorySessionStore(),
})
```

---

#### FileSessionStore

Persists to disk with `0o600` permissions (owner-only).

**Constructor:**
```typescript
new FileSessionStore(filePath: string)
```

**Example:**
```typescript
import { FileSessionStore } from 'nestjs-telegram/client';

TelegramClientModule.forRoot({
  apiId: 12345,
  apiHash: 'abc',
  sessionStore: new FileSessionStore('./session.txt'),
})
```

---

#### Custom Store

Implement `SessionStore` for Redis, database, secrets manager, etc.

**Example:**
```typescript
import { SessionStore } from 'nestjs-telegram/client';
import { Injectable } from '@nestjs/common';

@Injectable()
export class RedisSessionStore implements SessionStore {
  constructor(private redis: RedisClient) {}

  async load(): Promise<string | null> {
    return this.redis.get('telegram:session');
  }

  async save(session: string): Promise<void> {
    await this.redis.set('telegram:session', session);
  }

  async clear(): Promise<void> {
    await this.redis.del('telegram:session');
  }
}
```

---

### DTOs & Types

Library-owned data types (never import GramJS directly).

#### GramUser

```typescript
{
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
  isSelf: boolean;
  isBot: boolean;
  isPremium: boolean;
  isVerified: boolean;
  isScam: boolean;
  isFake: boolean;
}
```

---

#### GramDialog

```typescript
{
  id: string;
  title: string;
  isChannel: boolean;
  isGroup: boolean;
  isUser: boolean;
  unreadCount: number;
  isPinned: boolean;
  isMuted: boolean;
  isArchived: boolean;
  lastMessage?: GramMessage;
}
```

---

#### GramMessage

```typescript
{
  id: number;
  date: Date;
  text?: string;
  sender?: GramUser;
  chatId: string;
  isOutgoing: boolean;
  isForwarded: boolean;
  replyTo?: number;
  views?: number;
  forwards?: number;
  mediaType?: 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'sticker';
}
```

---

#### GramPeer

```typescript
type GramPeer = 'me' | string | number;
```

- `'me'` — Your Saved Messages
- `@username` — User/channel by username
- Numeric ID — User/chat ID

---

## Common

### Error Hierarchy

All library errors extend `TelegramError`.

#### TelegramError

Base class with discriminated `kind`.

**Properties:**
```typescript
{
  kind: TelegramErrorKind; // 'config' | 'bot-api' | 'client' | 'auth' | 'session'
  message: string;
  cause?: unknown;
}
```

**Type Guard:**
```typescript
import { isTelegramError } from 'nestjs-telegram';

if (isTelegramError(error)) {
  console.error(error.kind, error.message);
}
```

---

#### TelegramConfigError

Invalid module configuration.

**Kind:** `'config'`

**Example:** Empty bot token, missing API credentials

---

#### TelegramBotApiError

Bot API request failure.

**Kind:** `'bot-api'`

**Extra Properties:**
```typescript
{
  statusCode?: number;  // HTTP status
  method?: string;      // API method name
}
```

---

#### TelegramClientError

MTProto client operation failure.

**Kind:** `'client'`

**Extra Properties:**
```typescript
{
  operation?: string; // Operation name
}
```

---

#### TelegramAuthError

Authentication failure (MTProto).

**Kind:** `'auth'`

**Extra Properties:**
```typescript
{
  code: TelegramAuthErrorCode; // See below
  retryAfterSeconds?: number;  // For FLOOD_WAIT
}
```

**Error Codes:**
- `PHONE_INVALID` — Bad phone number format
- `CODE_INVALID` — Wrong login code
- `PASSWORD_REQUIRED` — 2FA enabled
- `PASSWORD_INVALID` — Wrong 2FA password
- `CODE_NOT_REQUESTED` — Called `signIn` before `sendCode`
- `SIGN_UP_REQUIRED` — Phone not registered
- `NOT_AUTHORIZED` — Not signed in
- `FLOOD_WAIT` — Rate limited
- `UNKNOWN` — Unexpected error

**Example:**
```typescript
import { isTelegramError } from 'nestjs-telegram';

try {
  await auth.signIn(code);
} catch (error) {
  if (isTelegramError(error) && error.kind === 'auth') {
    switch (error.code) {
      case 'CODE_INVALID':
        console.error('Wrong code');
        break;
      case 'PASSWORD_REQUIRED':
        // Prompt for 2FA
        break;
      case 'FLOOD_WAIT':
        console.error(`Retry in ${error.retryAfterSeconds}s`);
        break;
    }
  }
}
```

---

#### TelegramSessionError

Session load/save failure.

**Kind:** `'session'`

---

### Shared Types

#### ParseMode

```typescript
type ParseMode = 'Markdown' | 'MarkdownV2' | 'HTML';
```

Also available as `PARSE_MODES` object:
```typescript
import { PARSE_MODES } from 'nestjs-telegram';
PARSE_MODES.MARKDOWN // 'Markdown'
PARSE_MODES.HTML     // 'HTML'
```

---

#### ChatId

```typescript
type ChatId = number | string;
```

Accepts numeric ID or `@username`.

---

#### Awaitable<T>

```typescript
type Awaitable<T> = T | Promise<T>;
```

Helper for sync or async values.

---

## Umbrella Module

### TelegramModule

Composes both Bot API and MTProto in one module.

#### Static Methods

##### `forRoot(options): DynamicModule`

**Options:**
```typescript
{
  bot?: TelegramBotModuleOptions;
  client?: TelegramClientModuleOptions;
  isGlobal?: boolean; // Make services global (default: false)
}
```

**Example:**
```typescript
import { TelegramModule } from 'nestjs-telegram';

TelegramModule.forRoot({
  bot: { token: process.env.BOT_TOKEN! },
  client: {
    apiId: Number(process.env.TG_API_ID),
    apiHash: process.env.TG_API_HASH!,
  },
  isGlobal: true,
})
```

Both `bot` and `client` are optional—omit either to use only one side.

---

## Injection Tokens

Advanced: Inject raw instances directly.

### Bot API Tokens

```typescript
import { TELEGRAM_BOT } from 'nestjs-telegram/bot';

@Injectable()
export class MyService {
  constructor(@Inject(TELEGRAM_BOT) private telegraf: Telegraf) {}
}
```

### MTProto Tokens

```typescript
import { TELEGRAM_GRAM_CLIENT } from 'nestjs-telegram/client';

@Injectable()
export class MyService {
  constructor(@Inject(TELEGRAM_GRAM_CLIENT) private client: IGramClient) {}
}
```

---

## Type Imports

Access Telegraf and GramJS types without importing the SDKs:

```typescript
import type { Context, Markup } from 'telegraf';
import type { GramUser, GramMessage } from 'nestjs-telegram/client';
```

---

**Next:** [EXAMPLES.md](./EXAMPLES.md) for practical recipes.
