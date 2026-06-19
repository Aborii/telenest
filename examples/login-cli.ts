/**
 * @file examples/login-cli.ts
 *
 * PURPOSE
 * -------
 * Interactive command-line login for the MTProto (user account) side. Run it
 * once to sign in with your own Telegram account and obtain a *string session*;
 * save that string as `TG_SESSION` so your app reconnects without logging in
 * again. This demonstrates using the library OUTSIDE of NestJS DI — the same
 * services work when constructed directly.
 *
 * USAGE
 * -----
 * 1. Fill TG_API_ID, TG_API_HASH (and optionally TG_PHONE) in `.env`.
 * 2. `npm run login`
 * 3. Enter the code Telegram sends you (and your 2FA password if enabled).
 * 4. Copy the printed session string into `.env` as `TG_SESSION`.
 *
 * ENVIRONMENT VARIABLES
 * ---------------------
 * - TG_API_ID    : Application api_id from my.telegram.org (required).
 * - TG_API_HASH  : Application api_hash from my.telegram.org (required).
 * - TG_PHONE     : Phone number in international format (optional; prompted).
 * - TG_SESSION   : Existing session to resume (optional).
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
 * Runs the interactive login flow and prints the resulting string session.
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
      const phone =
        process.env.TG_PHONE ?? (await rl.question('Phone (+countrycode…): '));
      await auth.sendCode(phone);

      const code = await rl.question('Login code from Telegram: ');
      const step = await auth.signIn(code);

      if (step.status === 'password-required') {
        const pw = await rl.question('Two-factor (2FA) password: ');
        await auth.checkPassword(pw);
      }
      output.write('Signed in successfully.\n');
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
