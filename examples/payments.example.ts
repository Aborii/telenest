/**
 * @file examples/payments.example.ts
 *
 * PURPOSE
 * -------
 * A copy-paste reference for the Telegram **Payments** checkout flow on the Bot
 * API side. It shows the full round-trip:
 *
 *   1. `sendInvoice` — present an invoice to the user.
 *   2. `@ShippingQuery` + `answerShippingQuery` — offer shipping options for a
 *      flexible (physical-goods) invoice.
 *   3. `@PreCheckoutQuery` + `answerPreCheckoutQuery` — the mandatory final
 *      confirmation (must be answered within 10 seconds).
 *   4. `@SuccessfulPayment` — fulfil the order once the charge clears.
 *
 * The payment update decorators (`@PreCheckoutQuery`, `@ShippingQuery`,
 * `@SuccessfulPayment`) and their parameter decorators (`@PreCheckoutData`,
 * `@ShippingData`, `@SuccessfulPaymentData`) are the first-class way to handle
 * these updates; `TelegramBotService` wraps the outbound calls.
 *
 * Before this works, set a payment provider token with @BotFather
 * (`/mybots → Payments`). Invoices priced in `XTR` (Telegram Stars) use an empty
 * provider token and never raise a `shipping_query`.
 *
 * This file is illustrative — it is not part of the published package — but it is
 * type-checked (see tsconfig `include`) so it never drifts from the API.
 *
 * SECURITY
 * --------
 * Never log `successful_payment.telegram_payment_charge_id` /
 * `provider_payment_charge_id`; treat them as secrets used only for refunds.
 *
 * USAGE
 * -----
 * Adapt `PaymentsExampleModule` into your own app, then `app.init()` as usual.
 *
 * KEY EXPORTS
 * -----------
 * - PaymentsUpdate: the decorated payments update provider.
 * - PaymentsExampleModule: wires TelegramBotModule + the handler.
 */

import { Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Context } from 'telegraf';
import type {
  PreCheckoutQuery,
  ShippingQuery,
  SuccessfulPayment,
} from 'telegraf/types';

import {
  Command,
  Ctx,
  PreCheckoutQuery as OnPreCheckoutQuery,
  ShippingQuery as OnShippingQuery,
  SuccessfulPayment as OnSuccessfulPayment,
  PreCheckoutData,
  ShippingData,
  SuccessfulPaymentData,
  TelegramBotModule,
  TelegramBotService,
  TelegramUpdate,
} from '../src';

/** The opaque payload echoed through every stage of one invoice's lifecycle. */
const PRO_PLAN_PAYLOAD = 'pro-plan-monthly' as const;

/**
 * Update provider implementing a minimal paid "Pro plan" purchase. Every method
 * is bound onto the bot by the registrar; the class must wear `@TelegramUpdate()`
 * to be scanned. The provider token is injected from config at send time.
 *
 * @param _bot - The Bot API facade used to send the invoice and answer queries.
 * @param _config - Configuration source for the payment provider token.
 */
@TelegramUpdate()
@Injectable()
export class PaymentsUpdate {
  constructor(
    private readonly _bot: TelegramBotService,
    private readonly _config: ConfigService,
  ) {}

  /**
   * `/buy` — sends the Pro-plan invoice. `need_shipping_address` collects an
   * address and `is_flexible` makes the price depend on shipping, so a
   * `shipping_query` follows; drop both for purely digital goods.
   *
   * @param ctx - The raw Telegraf context (for the target chat id).
   * @returns Resolves once the invoice is sent.
   * @throws {import('../src').TelegramBotApiError} If the send fails.
   */
  @Command('buy')
  public async onBuy(@Ctx() ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    await this._bot.sendInvoice(chatId, {
      title: 'Pro plan',
      description: 'One month of Pro features.',
      payload: PRO_PLAN_PAYLOAD,
      provider_token: this._config.getOrThrow<string>('PAYMENT_PROVIDER_TOKEN'),
      currency: 'USD',
      // ── Amounts are in the currency's smallest unit (cents → $9.99). ──────────
      prices: [{ label: 'Pro plan (1 month)', amount: 999 }],
      // ── need_shipping_address makes Telegram collect an address, and
      //    is_flexible makes it raise a shipping_query (see onShipping). ─────────
      need_shipping_address: true,
      is_flexible: true,
    });
  }

  /**
   * Offers shipping options for the flexible invoice. Only fired for invoices
   * sent with `is_flexible: true`; reject with `ok: false` + a message to refuse
   * an unsupported address.
   *
   * @param query - The shipping query (`invoice_payload`, `shipping_address`).
   * @param ctx - The raw Telegraf context (for `answerShippingQuery`).
   * @returns Resolves once the query is answered.
   * @throws {import('../src').TelegramBotApiError} If the answer fails.
   */
  @OnShippingQuery()
  public async onShipping(
    @ShippingData() query: ShippingQuery | undefined,
    @Ctx() ctx: Context,
  ): Promise<void> {
    if (query?.invoice_payload !== PRO_PLAN_PAYLOAD) return;

    await ctx.answerShippingQuery(
      true,
      [
        {
          id: 'standard',
          title: 'Standard delivery',
          prices: [{ label: 'Shipping', amount: 500 }],
        },
      ],
      // ── No error message — the address is accepted. ─────────────────────────
      undefined,
    );
  }

  /**
   * The mandatory pre-checkout confirmation. Validate the order is still
   * fulfillable, then approve within 10 seconds (or Telegram cancels the
   * payment). Reject with `ok: false` + a user-facing message to abort.
   *
   * @param query - The pre-checkout query (`invoice_payload`, `total_amount`).
   * @param ctx - The raw Telegraf context (for `answerPreCheckoutQuery`).
   * @returns Resolves once the query is answered.
   * @throws {import('../src').TelegramBotApiError} If the answer fails.
   */
  @OnPreCheckoutQuery()
  public async onPreCheckout(
    @PreCheckoutData() query: PreCheckoutQuery | undefined,
    @Ctx() ctx: Context,
  ): Promise<void> {
    const fulfillable = query?.invoice_payload === PRO_PLAN_PAYLOAD;
    await ctx.answerPreCheckoutQuery(
      fulfillable,
      fulfillable ? undefined : 'This plan is no longer available.',
    );
  }

  /**
   * Fulfils the order after the charge clears. This is the only stage where the
   * money has actually moved — grant access here, idempotently keyed on the
   * payload. Never log the charge ids.
   *
   * @param payment - The successful-payment payload.
   * @param ctx - The raw Telegraf context (to confirm to the user).
   * @returns Resolves once fulfilment + confirmation complete.
   * @throws {import('../src').TelegramBotApiError} If the confirmation fails.
   */
  @OnSuccessfulPayment()
  public async onPaid(
    @SuccessfulPaymentData() payment: SuccessfulPayment | undefined,
    @Ctx() ctx: Context,
  ): Promise<void> {
    if (payment?.invoice_payload !== PRO_PLAN_PAYLOAD) return;

    // grantProAccess(ctx.from?.id) — your own idempotent fulfilment.
    await ctx.reply('Thanks! Your Pro plan is now active. 🎉');
  }
}

/**
 * Root module: wires the Bot API side and registers the payments handler.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TelegramBotModule.forRootAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        token: config.getOrThrow<string>('BOT_TOKEN'),
      }),
    }),
  ],
  providers: [PaymentsUpdate],
})
export class PaymentsExampleModule {}
