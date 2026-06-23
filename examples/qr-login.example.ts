/**
 * @file examples/qr-login.example.ts
 *
 * PURPOSE
 * -------
 * Interactive QR-code login for the MTProto (user account) side. Instead of the
 * phone/code flow, this prints a `tg://login?token=…` URL that you render as a
 * QR code and scan from an already–signed-in Telegram app (Settings → Devices →
 * Link Desktop Device). On success it prints a reusable *string session* — save
 * it as `TG_SESSION`, exactly like `login-cli.ts`. Demonstrates using the
 * library OUTSIDE of NestJS DI.
 *
 * USAGE
 * -----
 * 1. Fill TG_API_ID and TG_API_HASH in `.env`.
 * 2. `npx ts-node -P tsconfig.json examples/qr-login.example.ts`
 * 3. Render the printed URL as a QR code (e.g. pipe it to `qrcode-terminal`, or
 *    paste it into any QR generator) and scan it from the Telegram app.
 * 4. If the account has 2FA, enter the password when prompted.
 * 5. Copy the printed session string into `.env` as `TG_SESSION`.
 *
 * ENVIRONMENT VARIABLES
 * ---------------------
 * - TG_API_ID   : Application api_id from my.telegram.org (required).
 * - TG_API_HASH : Application api_hash from my.telegram.org (required).
 * - TG_SESSION  : Existing session to resume (optional).
 *
 * SAFETY GUARDS
 * -------------
 * - The session string grants full access to your account — never commit it.
 * - The client always disconnects in a `finally` block.
 */

import 'dotenv/config';

import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import {
  createGramJsClient,
  isTelegramError,
  TelegramAuthService,
} from '../src';

/**
 * Runs the interactive QR-code login flow and prints the resulting session.
 *
 * @returns Resolves when the flow completes (or fails gracefully).
 * @throws {Error} If required environment variables are missing.
 */
async function main(): Promise<void> {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH ?? '';
  if (!apiId || !apiHash)
    throw new Error('Set TG_API_ID and TG_API_HASH in your environment/.env.');

  const initialSession = process.env.TG_SESSION ?? '';
  const client = createGramJsClient({ apiId, apiHash }, initialSession);
  const auth = new TelegramAuthService(client);
  const rl = createInterface({ input, output });

  try {
    if (await auth.isAuthorized()) {
      output.write('Already authorized with the provided TG_SESSION.\n');
    } else {
      // ── Start the QR flow: render each token's URL and resolve 2FA on demand.
      const { qr$, completed } = auth.signInWithQrCode({
        onPassword: () => rl.question('Two-factor (2FA) password: '),
      });

      const subscription = qr$.subscribe((token) => {
        output.write('\nScan this from Telegram (Settings → Devices):\n');
        output.write(`${token.url}\n`);
      });

      // ── Resolves once the QR code is scanned (and 2FA satisfied). ───────────
      const me = await completed;
      subscription.unsubscribe();
      output.write(`\nSigned in successfully as ${me.firstName ?? me.id}.\n`);
    }

    output.write('\n=== SESSION STRING (save as TG_SESSION) ===\n');
    output.write(`${auth.exportSession()}\n`);
  } catch (error) {
    if (isTelegramError(error))
      output.write(`\nTelegram error [${error.kind}]: ${error.message}\n`);
    else output.write(`\nUnexpected error: ${String(error)}\n`);
    process.exitCode = 1;
  } finally {
    rl.close();
    await client.disconnect();
  }
}

void main();
