# Bot API Scenes & Wizards

First-class, decorator-based **scenes** and **wizards** for `nestjs-telegram` —
declarative multi-step conversational flows (onboarding, forms, surveys, guided
menus) **without** `nestjs-telegraf` and without hand-rolling a Telegraf `Stage`
against the raw instance. You declare a scene as an ordinary NestJS provider; a
`DiscoveryService`-driven registrar finds every `@Scene` / `@WizardScene` class at
bootstrap, builds the matching Telegraf scene, and registers the session + `Stage`
middleware **before launch**.

Inside a scene you reuse everything the top-level update system already gives you:
the same message decorators (`@Command`, `@Hears`, `@Action`, `@On`, `@Use`,
`@Start`, `@Help`), the same parameter decorators (`@Ctx`, `@MessageText`,
`@Sender`, `@CallbackData`), and the same enhancer stack (`@UseTelegramGuards`,
`@UseTelegramInterceptors`, `@UseTelegramFilters`).

> **Bot API only.** Scenes drive the Bot API side (`TelegramBotModule`, a BotFather
> token), and pair with the update decorators in
> [BOT-UPDATE-DECORATORS.md](./BOT-UPDATE-DECORATORS.md). They are unrelated to the
> MTProto user-account system.

---

## Table of contents

- [Architecture overview](#architecture-overview)
- [File structure](#file-structure)
- [Quick start](#quick-start)
- [Plain scenes (`@Scene`)](#plain-scenes-scene)
- [Wizards (`@WizardScene` + `@WizardStep`)](#wizards-wizardscene--wizardstep)
- [Session middleware](#session-middleware)
- [Bootstrap ordering](#bootstrap-ordering)
- [Multiple bots](#multiple-bots)
- [Guards, interceptors & filters in scenes](#guards-interceptors--filters-in-scenes)
- [Behaviour notes & edge cases](#behaviour-notes--edge-cases)
- [Security notes](#security-notes)
- [How to extend](#how-to-extend)

---

## Architecture overview

The system lives under `src/lib/bot/scenes` and has four cooperating pieces:

1. **Decorators** record intent as reflect-metadata.
   - `@Scene(id)` / `@WizardScene(id)` mark a class as a scene provider and record
     a `SceneDefinition` (`id`, `kind`, target `bot`). The marker doubles as the
     discovery scan flag.
   - Lifecycle decorators (`@SceneEnter`, `@SceneLeave`, `@WizardStep(n)`) append a
     `SceneMethodBinding` describing the hook a method implements.
   - Within-scene message handlers reuse the existing `@Command`/`@Hears`/… method
     decorators and `@Ctx`/`@MessageText`/… parameter decorators **unchanged**.
2. **The scene builder** (`buildScene`) is a pure function that turns a scene's
   harvested metadata + per-method runners into a configured Telegraf
   `Scenes.BaseScene` or `Scenes.WizardScene`.
3. **The scenes registrar** (`TelegramBotScenesRegistrar`) discovers `@Scene`
   providers for one bot, resolves each method's enhancers + argument injection
   into a runner (via the shared dispatcher the update registrar also uses), builds
   the scenes, groups them into a `Scenes.Stage`, and registers the `session` +
   `Stage` middleware on the bot.
4. **`TelegramBotModule`** wires a scenes registrar per bot and lets the update
   registrar invoke it at the right point in bootstrap (see
   [Bootstrap ordering](#bootstrap-ordering)).

```text
@Scene / @WizardScene class ──(decorators write metadata)──► reflect-metadata
                                                                  │
TelegramBotUpdatesRegistrar.onModuleInit()                        │
  ├─ bind @Use() global middleware                                │
  ├─ TelegramBotScenesRegistrar.register() ◄──── discovers + builds scenes
  │     └─ bot.use(session(), stage.middleware())                 │
  └─ bind terminal handlers (@Command, @Hears, …)                 │
```

Because the update registrar drives scene registration between its `@Use` pass and
its terminal pass, global middleware still runs for every update, the scene `Stage`
intercepts active scenes ahead of the terminal handlers, and a terminal match never
short-circuits either earlier phase.

---

## File structure

```text
src/lib/bot/scenes/
  scene.types.ts                    # metadata keys, SceneDefinition, SceneMethodBinding
  scene.decorators.ts               # @Scene/@WizardScene/@SceneEnter/@SceneLeave/@WizardStep
  scene.builder.ts                  # buildScene(): metadata + runners → BaseScene/WizardScene
  telegram-bot-scenes.registrar.ts  # discovery, Stage, session + Stage middleware
  index.ts                          # public barrel
```

The shared dispatcher both registrars use lives at
`src/lib/bot/updates/execution/handler-dispatch.ts`.

---

## Quick start

```ts
import { Module } from '@nestjs/common';
import {
  Command, Ctx, Scene, SceneEnter, SceneLeave,
  TelegramBotModule, TelegramUpdate,
  WizardScene, WizardStep, MessageText,
} from 'nestjs-telegram';
import { Scenes } from 'telegraf';

type FlowContext = Scenes.WizardContext;

// A top-level handler enters the flow.
@TelegramUpdate()
export class EntryUpdate {
  @Command('signup')
  async start(@Ctx() ctx: FlowContext) { await ctx.scene.enter('signup'); }
}

// A two-step wizard.
@WizardScene('signup')
export class SignupWizard {
  @WizardStep(1)
  async askName(@Ctx() ctx: FlowContext) {
    await ctx.reply('What should I call you?');
    ctx.wizard.next();
  }

  @WizardStep(2)
  async saveName(@Ctx() ctx: FlowContext, @MessageText() text?: string) {
    await ctx.reply(`Thanks, ${text}!`);
    await ctx.scene.leave();
  }
}

@Module({
  imports: [TelegramBotModule.forRoot({ token: process.env.BOT_TOKEN! })],
  providers: [EntryUpdate, SignupWizard],
})
export class AppModule {}
```

That's all — no manual `Stage`, no manual `session()`. A full runnable reference is
in [`examples/scenes-wizards.example.ts`](../examples/scenes-wizards.example.ts).

---

## Plain scenes (`@Scene`)

A `@Scene(id)` provider builds a Telegraf `Scenes.BaseScene`. Decorate methods with:

| Decorator | Binds to | Fires |
| --- | --- | --- |
| `@SceneEnter()` | `scene.enter(...)` | each time the scene is entered |
| `@SceneLeave()` | `scene.leave(...)` | each time the scene is left |
| `@Command` / `@Hears` / `@Action` / `@On` / `@Use` / `@Start` / `@Help` | the scene's `Composer` | while the scene is active |

```ts
@Scene('survey')
export class SurveyScene {
  @SceneEnter() onEnter(@Ctx() ctx: Scenes.SceneContext) { return ctx.reply('Started.'); }
  @Hears('again') onAgain(@Ctx() ctx: Scenes.SceneContext) { return ctx.reply('Again!'); }
  @Command('quit') onQuit(@Ctx() ctx: Scenes.SceneContext) { return ctx.scene.leave(); }
  @SceneLeave() onLeave(@Ctx() ctx: Scenes.SceneContext) { return ctx.reply('Closed.'); }
}
```

Multiple `@SceneEnter` / `@SceneLeave` methods are all bound. Message handlers
inside a scene only run while that scene is the active one.

---

## Wizards (`@WizardScene` + `@WizardStep`)

A `@WizardScene(id)` provider builds a Telegraf `Scenes.WizardScene`. Its **steps**
are the `@WizardStep(n)`-decorated methods, ordered by their 1-based position. On
entering, the wizard runs step 1; advance the cursor with `ctx.wizard.next()` (or
`ctx.wizard.back()` / `ctx.wizard.selectStep(i)`) and finish with
`ctx.scene.leave()`. Per-flow state lives on `ctx.wizard.state`.

```ts
@WizardScene('signup')
export class SignupWizard {
  @WizardStep(1) askName(@Ctx() ctx: Scenes.WizardContext) { ctx.wizard.next(); }
  @WizardStep(2) saveName(@Ctx() ctx: Scenes.WizardContext) { return ctx.scene.leave(); }
}
```

A wizard may also declare `@SceneEnter` / `@SceneLeave` and within-scene message
handlers, exactly like a plain scene.

**Validation (fails fast at bootstrap with `TelegramConfigError`):**

- a `@WizardScene` must declare at least one `@WizardStep`;
- step positions must be integers ≥ 1 and **unique**;
- `@WizardStep` on a plain `@Scene` is rejected — use `@WizardScene`.

---

## Session middleware

Scenes require `ctx.session` (Telegraf stores the active scene and wizard cursor in
`session.__scenes`). When a bot has scenes, the registrar auto-registers Telegraf's
in-memory `session()` middleware ahead of the `Stage`, so scenes work with **zero**
configuration.

To use your own session (e.g. [`@telegraf/session`](https://www.npmjs.com/package/@telegraf/session)
for persistence across restarts), register it yourself via a `@Use()` handler and
opt out of the built-in one:

```ts
TelegramBotModule.forRoot({ token, scenes: { session: false } });
```

> ⚠️ The default session is **in-memory** — scene/wizard state is lost on process
> restart. Use a persistent store for production flows you must resume.

---

## Bootstrap ordering

Telegraf runs middleware in registration order, and a terminal handler (`@Command`,
`@Hears`, …) that matches does **not** call `next`. The update registrar therefore
registers in three deliberate phases on the shared `Telegraf` instance:

1. `@Use()` global middleware — runs for **every** update (it calls `next`);
2. the scene `session` + `Stage` middleware — the `Stage` routes active scenes and
   otherwise calls `next`;
3. terminal handlers (`@Command`, `@Hears`, `@Action`, `@On`, `@Start`, `@Help`).

This guarantees your global middleware still sees every update, while an active
scene intercepts before the bot-level terminal handlers run.

---

## Multiple bots

Scope a scene to a named bot exactly like `@TelegramUpdate`:

```ts
@Scene('ticket', { bot: 'support' })
export class TicketScene { /* ... */ }
```

Each bot gets its own scenes registrar and its own `Stage`; a scene is only built
and registered on the bot whose name it targets (the default bot when `bot` is
omitted). See [MULTIPLE-BOTS.md](./MULTIPLE-BOTS.md).

---

## Guards, interceptors & filters in scenes

Scene handlers run through the **same** enhancer pipeline as top-level handlers, so
`@UseTelegramGuards`, `@UseTelegramInterceptors`, and `@UseTelegramFilters` work on
scene classes and methods identically:

```ts
@Scene('admin')
@UseTelegramGuards(AdminGuard)            // class-level: every handler in the scene
export class AdminScene {
  @SceneEnter()
  @UseTelegramInterceptors(AuditInterceptor)   // method-level
  onEnter(@Ctx() ctx: Scenes.SceneContext) { /* ... */ }
}
```

See [BOT-GUARDS-FILTERS-INTERCEPTORS.md](./BOT-GUARDS-FILTERS-INTERCEPTORS.md) for
the enhancer contracts.

---

## Behaviour notes & edge cases

- **Errors are isolated.** A throwing scene handler is logged, never rethrown — one
  failing handler never breaks the update pipeline (same guarantee as top-level
  handlers, via the shared dispatcher).
- **No scenes → no middleware.** If a bot declares no scenes, the registrar adds
  neither `session` nor `Stage` middleware.
- **`@Ctx` typing.** Inside a scene, type the context as `Scenes.SceneContext` (or
  `Scenes.WizardContext` for wizards) to get `ctx.scene` / `ctx.wizard`.
- **Custom context.** You may declare a richer context type for your handlers; the
  runner reads only through the base `Context`, so any `Context` subtype works.

---

## Security notes

- Scene/wizard state is keyed by Telegram's default session key
  (`<from.id>:<chat.id>`). Treat any data you stash on `ctx.wizard.state` /
  `ctx.scene.state` as untrusted user-scoped input — validate before use.
- The default in-memory session is process-local and not shared across instances;
  do not rely on it for security-sensitive, must-persist state.
- Secrets (tokens, session strings) are never logged by the registrar.

---

## How to extend

- **New lifecycle hook?** Add a kind to `SCENE_METHOD_KINDS`, a decorator in
  `scene.decorators.ts`, and handle it in `scene.builder.ts`.
- **New within-scene trigger?** It already works — any `UpdateBinding` kind the
  top-level decorators emit is bound onto the scene's `Composer` by the builder.
- **Custom session store?** Set `scenes: { session: false }` and register your own
  session middleware with `@Use()`.
