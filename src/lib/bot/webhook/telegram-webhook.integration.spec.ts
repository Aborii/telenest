/**
 * @file src/lib/bot/webhook/telegram-webhook.integration.spec.ts
 *
 * PURPOSE
 * -------
 * End-to-end tests for the built-in webhook controller: they boot a real Nest
 * HTTP application (Express adapter) on an ephemeral loopback port and POST fake
 * updates over `fetch`, proving the issue's acceptance criteria — a correct
 * secret token dispatches to `handleUpdate` and returns `200`, while a wrong or
 * missing token is rejected with `403`. Also covers an unauthenticated route,
 * `registerOnBootstrap`, and per-bot routing for multiple named bots.
 *
 * No external network is touched: the loopback server is our own app, and each
 * bot's raw `Telegraf` is replaced with a recording mock, so `handleUpdate` /
 * `setWebhook` never call Telegram.
 */

import type { INestApplication, InjectionToken } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Telegraf } from 'telegraf';

import { TELEGRAM_BOT } from '../telegram-bot.constants';
import { TelegramBotModule } from '../telegram-bot.module';
import { getBotInstanceToken } from '../telegram-bot.tokens';
import { TELEGRAM_WEBHOOK_SECRET_HEADER } from './telegram-webhook.constants';

/** A fake Telegraf recording the dispatched updates and webhook registration. */
interface FakeBot {
  bot: Telegraf;
  handleUpdate: jest.Mock;
  setWebhook: jest.Mock;
}

/** Builds a fake Telegraf whose webhook-relevant methods are recorded. */
function createFakeBot(): FakeBot {
  const handleUpdate = jest.fn().mockResolvedValue(undefined);
  const setWebhook = jest.fn().mockResolvedValue(true);
  const bot = { handleUpdate, telegram: { setWebhook } } as unknown as Telegraf;
  return { bot, handleUpdate, setWebhook };
}

/** A minimal but well-formed Telegram update payload. */
const FAKE_UPDATE = {
  update_id: 1,
  message: { message_id: 1, text: 'hi', chat: { id: 42 } },
} as const;

// ── Booting a real Nest HTTP app (Express) is slow on first compile; give the
//    e2e suite headroom over Jest's 5s default. ───────────────────────────────
jest.setTimeout(30000);

/** The currently-running app, closed after each test. */
let app: INestApplication | undefined;

/** Boots the given module imports into a listening Nest HTTP app. */
async function listen(
  imports: Parameters<typeof Test.createTestingModule>[0]['imports'],
  overrides: ReadonlyArray<{ token: InjectionToken; bot: Telegraf }>,
): Promise<number> {
  let builder = Test.createTestingModule({ imports });
  for (const override of overrides)
    builder = builder.overrideProvider(override.token).useValue(override.bot);

  const moduleRef = await builder.compile();
  app = moduleRef.createNestApplication();
  // ── listen() runs the bootstrap lifecycle (so the registrar fires) and binds
  //    an OS-chosen free port on loopback. ──────────────────────────────────────
  await app.listen(0);
  const address = (app.getHttpServer() as Server).address() as AddressInfo;
  return address.port;
}

/** POSTs an update to the webhook route, optionally with a secret-token header. */
async function post(
  port: number,
  path: string,
  secretToken?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (secretToken !== undefined)
    headers[TELEGRAM_WEBHOOK_SECRET_HEADER] = secretToken;
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(FAKE_UPDATE),
  });
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('webhook controller (e2e)', () => {
  const path = '/telegram/webhook';
  const secret = 's3cr3t-token';

  it('dispatches an update and returns 200 when the secret token matches', async () => {
    const fake = createFakeBot();
    const port = await listen(
      [
        TelegramBotModule.forRoot({
          token: '123:abc',
          launch: false,
          webhook: { path, secretToken: secret },
        }),
      ],
      [{ token: TELEGRAM_BOT, bot: fake.bot }],
    );

    const response = await post(port, path, secret);

    expect(response.status).toBe(200);
    expect(fake.handleUpdate).toHaveBeenCalledTimes(1);
    expect(fake.handleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ update_id: 1 }),
    );
  });

  it('rejects with 403 when the secret token is wrong', async () => {
    const fake = createFakeBot();
    const port = await listen(
      [
        TelegramBotModule.forRoot({
          token: '123:abc',
          launch: false,
          webhook: { path, secretToken: secret },
        }),
      ],
      [{ token: TELEGRAM_BOT, bot: fake.bot }],
    );

    const response = await post(port, path, 'wrong-token');

    expect(response.status).toBe(403);
    expect(fake.handleUpdate).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the secret-token header is missing', async () => {
    const fake = createFakeBot();
    const port = await listen(
      [
        TelegramBotModule.forRoot({
          token: '123:abc',
          launch: false,
          webhook: { path, secretToken: secret },
        }),
      ],
      [{ token: TELEGRAM_BOT, bot: fake.bot }],
    );

    const response = await post(port, path);

    expect(response.status).toBe(403);
    expect(fake.handleUpdate).not.toHaveBeenCalled();
  });

  it('accepts any request when allowInsecure is set (no secret token)', async () => {
    const fake = createFakeBot();
    const port = await listen(
      [
        TelegramBotModule.forRoot({
          token: '123:abc',
          launch: false,
          webhook: { path, allowInsecure: true },
        }),
      ],
      [{ token: TELEGRAM_BOT, bot: fake.bot }],
    );

    const response = await post(port, path);

    expect(response.status).toBe(200);
    expect(fake.handleUpdate).toHaveBeenCalledTimes(1);
  });

  it('registers the webhook on bootstrap when opted in', async () => {
    const fake = createFakeBot();
    await listen(
      [
        TelegramBotModule.forRoot({
          token: '123:abc',
          launch: false,
          webhook: {
            path,
            domain: 'https://bot.example.com',
            secretToken: secret,
            registerOnBootstrap: true,
          },
        }),
      ],
      [{ token: TELEGRAM_BOT, bot: fake.bot }],
    );

    expect(fake.setWebhook).toHaveBeenCalledWith(
      'https://bot.example.com/telegram/webhook',
      { secret_token: secret },
    );
  });

  it('routes each named bot to its own webhook path', async () => {
    const notify = createFakeBot();
    const support = createFakeBot();
    const notifyPath = '/hooks/notify';
    const supportPath = '/hooks/support';

    const port = await listen(
      [
        TelegramBotModule.forRoot({
          name: 'notify',
          token: '111:aaa',
          launch: false,
          webhook: { path: notifyPath, secretToken: 'notify-secret' },
        }),
        TelegramBotModule.forRoot({
          name: 'support',
          token: '222:bbb',
          launch: false,
          webhook: { path: supportPath, secretToken: 'support-secret' },
        }),
      ],
      [
        { token: getBotInstanceToken('notify'), bot: notify.bot },
        { token: getBotInstanceToken('support'), bot: support.bot },
      ],
    );

    // ── Each route only accepts its own bot's secret and dispatches to only
    //    that bot's instance. ─────────────────────────────────────────────────
    expect((await post(port, notifyPath, 'notify-secret')).status).toBe(200);
    expect(notify.handleUpdate).toHaveBeenCalledTimes(1);
    expect(support.handleUpdate).not.toHaveBeenCalled();

    expect((await post(port, supportPath, 'support-secret')).status).toBe(200);
    expect(support.handleUpdate).toHaveBeenCalledTimes(1);

    // ── The notify secret must not unlock the support route. ──────────────────
    expect((await post(port, supportPath, 'notify-secret')).status).toBe(403);
  });
});
