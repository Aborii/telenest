/**
 * @file src/lib/client/updates/on-chat-action.types.ts
 *
 * PURPOSE
 * -------
 * Public types for the `@OnChatAction` update system: the filter accepted by
 * {@link import('./on-chat-action.decorator').OnChatAction} and the handler
 * shape it tags.
 *
 * A chat-action event (typing / recording / online / offline / …) carries no
 * message body, so its filter supports a chat allowlist plus an optional
 * action-kind allowlist rather than the message direction/pattern criteria.
 *
 * USAGE
 * -----
 * ```ts
 * @OnChatAction({ actions: ['typing'] })
 * onTyping(event: GramChatActionEvent) { ... }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - OnChatActionFilter: Declarative match criteria for a chat-action handler.
 * - OnChatActionHandler: Shape of a method decorated with `@OnChatAction`.
 */

import type {
  GramChatAction,
  GramChatActionEvent,
  GramPeer,
} from '../gram-client.types';

/**
 * Declarative criteria deciding whether a chat-action event is dispatched to a
 * decorated handler. All present fields must match (logical AND); omitting a
 * field means "don't care".
 */
export interface OnChatActionFilter {
  /** Restrict to one or more chat/peer ids (matched against the event's `peerId`). */
  chatId?: GramPeer | readonly GramPeer[];
  /**
   * Restrict to one or more {@link GramChatAction} kinds (matched against the
   * event's `action`). Omit to receive every action kind.
   */
  actions?: GramChatAction | readonly GramChatAction[];
}

/** Shape of a method decorated with `@OnChatAction`. */
export type OnChatActionHandler = (
  event: GramChatActionEvent,
) => unknown | Promise<unknown>;
