# Mini App `initData` Validation

`validateWebAppInitData(initData, botToken, options?)` verifies and parses the
`initData` string a Telegram **Mini App (Web App)** sends to your backend. It is
the only way to trust a Mini App user's identity server-side: the data is signed
by Telegram with your bot token, and this function checks that signature with a
constant-time comparison before handing you a typed payload.

It is a **pure, dependency-free** function (Node's `crypto` only) — no network,
no NestJS, no Telegraf. Import it from the package root or the
`telenest/bot` subpath.

> **Bot API side.** This belongs to the Bot API surface because the signature is
> keyed by your **bot token**. It is unrelated to the MTProto user-account side.

---

## Table of contents

- [How it works](#how-it-works)
- [API](#api)
- [Return value & error semantics](#return-value--error-semantics)
- [Usage](#usage)
- [`WebAppInitData` shape](#webappinitdata-shape)
- [Security notes](#security-notes)
- [How to extend](#how-to-extend)

## How it works

Telegram's documented scheme
([core.telegram.org/bots/webapps](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)):

```text
secret_key       = HMAC_SHA256(key = "WebAppData", message = bot_token)
data_check_string= every field except `hash` and `signature`,
                   sorted alphabetically, "key=value" joined by "\n"
is_valid         = timingSafeEqual(HMAC_SHA256(key = secret_key, data_check_string), hash)
```

`hash` is the hex digest Telegram appended; `signature` (its newer Ed25519 field
for third-party validation) is **excluded** from the check-string, so init data
that carries a `signature` still validates. The comparison uses
`crypto.timingSafeEqual` to avoid leaking the hash byte-by-byte.

## API

```ts
function validateWebAppInitData(
  initData: string,
  botToken: string,
  options?: { maxAgeSeconds?: number },
): WebAppInitData | null;
```

| Parameter | Meaning |
| --- | --- |
| `initData` | The raw `window.Telegram.WebApp.initData` query string from the client. |
| `botToken` | The bot token whose Mini App produced the data. |
| `options.maxAgeSeconds` | Maximum accepted age (per `auth_date`); older data returns `null`. **Defaults to `86400` (24h)** — pass `0` (or a negative value) to disable the freshness check entirely. |

## Return value & error semantics

| Situation | Result |
| --- | --- |
| Signature valid (and fresh, if `maxAgeSeconds` set) | the parsed `WebAppInitData` |
| Signature does not match (tampered, wrong token, bad hash) | `null` |
| Data older than `maxAgeSeconds` | `null` |
| `botToken` empty, `hash` missing, bad `auth_date`, or unparseable `user`/`chat` JSON | **throws** `TelegramConfigError` |

The split is deliberate: a failed **trust** check is a `null` you branch on; a
**malformed request** (or misconfiguration) is an exception, because it signals a
broken client or a programming error rather than an untrusted caller.

## Usage

```ts
import { validateWebAppInitData } from 'telenest';

// In a controller / guard handling the Mini App's authenticated request:
const data = validateWebAppInitData(body.initData, process.env.BOT_TOKEN!, {
  maxAgeSeconds: 3600, // reject init data older than an hour
});

if (!data) throw new UnauthorizedException('Invalid Mini App init data');

const userId = data.user?.id;
const isPremium = data.user?.isPremium ?? false;
```

A natural fit is a NestJS guard that reads the header/body, calls
`validateWebAppInitData`, and attaches `data.user` to the request — keeping the
bot token on the server and never trusting client-sent identity directly.

## `WebAppInitData` shape

```ts
interface WebAppInitData {
  user?: WebAppUser;        // who launched the Mini App
  receiver?: WebAppUser;    // chat partner (attachment-menu, 1:1)
  chat?: WebAppChat;        // group/supergroup/channel it was opened from
  chatType?: string;        // 'sender' | 'private' | 'group' | 'supergroup' | 'channel'
  chatInstance?: string;
  queryId?: string;         // present when launched from an inline keyboard
  startParam?: string;      // t.me deep-link parameter
  canSendAfter?: number;
  authDate: Date;           // parsed from auth_date
  hash: string;             // the verified hash
  signature?: string;       // Ed25519 signature, if present
  raw: Readonly<Record<string, string>>; // every field as received
}
```

Field names are camelCased from Telegram's snake_case JSON. Anything not modelled
explicitly is still available under `raw`.

## Security notes

- **Always validate server-side.** Never trust `initDataUnsafe` from the client;
  only the HMAC-checked `initData` is trustworthy.
- **Keep the bot token secret.** It is the signing key — never expose it to the
  Mini App front-end. The token is read but never logged by this function.
- **Freshness is on by default (24h).** A captured valid `initData` would
  otherwise replay forever, so the check defaults to `86400` seconds. Lower it
  (e.g. `maxAgeSeconds: 3600`) for tighter bounds, or pass `0` to opt out.
- **Constant-time compare.** The hash check uses `timingSafeEqual`; a malformed or
  wrong-length hash fails closed (returns `null`).

## How to extend

- **New Telegram fields:** add the camelCased property to `WebAppInitData` and map
  it in `buildInitData`; until then it is already reachable via `raw`.
- **Custom freshness/clock:** the freshness check uses `Date.now()`; wrap the
  function if you need an injectable clock for testing or skew tolerance.
```
