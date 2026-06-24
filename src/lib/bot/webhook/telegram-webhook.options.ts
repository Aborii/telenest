/**
 * @file src/lib/bot/webhook/telegram-webhook.options.ts
 *
 * PURPOSE
 * -------
 * Public configuration contract for the built-in Telegram **webhook controller**.
 * Supplying this object (as the `webhook` extra of `TelegramBotModule.forRoot` /
 * `forRootAsync`) makes the module stand up an HTTP `POST` route that feeds
 * incoming Telegram updates into the bot — so consumers no longer have to mount
 * `bot.webhookCallback(path)` on their HTTP server by hand — and enables
 * Telegram's secret-token verification on that route.
 *
 * USAGE
 * -----
 * ```ts
 * TelegramBotModule.forRoot({
 *   token: process.env.BOT_TOKEN!,
 *   launch: false, // webhook mode: do NOT also start long-polling
 *   webhook: {
 *     path: '/telegram/webhook',
 *     domain: 'https://bot.example.com',
 *     secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
 *     registerOnBootstrap: true,
 *   },
 * });
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramBotWebhookOptions: Shape of the `webhook` configuration object.
 */

/**
 * Configuration for the built-in webhook controller.
 *
 * This object is read **synchronously** at module-registration time (it lives in
 * the module *extras*, like `name`), because the controller's HTTP route has to
 * be known before the dynamic module is built — even for `forRootAsync`. Read
 * deployment values from `process.env` (which is synchronous) when wiring it.
 */
export interface TelegramBotWebhookOptions {
  /**
   * HTTP path the webhook controller listens on (e.g. `'/telegram/webhook'`). A
   * leading slash is optional. When running multiple named bots in one app, each
   * bot's webhook must use a **distinct** path or the routes will collide.
   */
  path: string;

  /**
   * Public HTTPS origin Telegram should deliver updates to (e.g.
   * `'https://bot.example.com'`). Combined with {@link path} to form the URL
   * passed to `setWebhook`. Required only when
   * {@link TelegramBotWebhookOptions.registerOnBootstrap} is `true`.
   */
  domain?: string;

  /**
   * Secret token verified against Telegram's `X-Telegram-Bot-Api-Secret-Token`
   * request header on every delivery (1–256 chars of `A-Z a-z 0-9 _ -`). When
   * set, requests with a missing or wrong token are rejected with `403`.
   *
   * A secret is **required by default** — omitting it throws at registration so an
   * unauthenticated webhook is never stood up by accident. Use
   * {@link import('./secret-token').generateWebhookSecret} to mint one, or set
   * {@link TelegramBotWebhookOptions.allowInsecure} to `true` to deliberately run
   * the route without authentication.
   */
  secretToken?: string;

  /**
   * Opt in to running the webhook route **without** a secret token. Required when
   * {@link TelegramBotWebhookOptions.secretToken} is omitted, otherwise
   * registration throws. When `true`, the route accepts any request that reaches
   * it — only do this if the endpoint is protected another way (e.g. a private
   * network, an upstream proxy that authenticates Telegram, or IP allow-listing).
   * Defaults to `false`.
   */
  allowInsecure?: boolean;

  /**
   * When `true`, the module calls `setWebhook(domain + path, { secret_token })`
   * on application bootstrap so the route is registered with Telegram
   * automatically. Requires {@link TelegramBotWebhookOptions.domain}. Defaults to
   * `false`, leaving registration to the consumer (e.g. an infra script).
   */
  registerOnBootstrap?: boolean;
}
