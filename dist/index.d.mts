import { SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";

//#region src/SupabaseProvider.d.ts
type SupabaseProviderOptions = {
  broadcastThrottleMs?: number;
  /** Enable automatic reconnection on disconnect. Default: true */
  autoReconnect?: boolean;
  /** Maximum reconnection attempts. Default: Infinity */
  maxReconnectAttempts?: number;
  /** Initial reconnection delay in ms. Default: 1000 */
  reconnectDelay?: number;
  /** Maximum reconnection delay in ms. Default: 30000 */
  maxReconnectDelay?: number;
};
type Status = 'connecting' | 'connected' | 'disconnected';
type ProviderEventMap = {
  message: (update: Uint8Array) => void;
  status: (status: Status) => void;
  connect: (provider: SupabaseProvider) => void;
  disconnect: (provider: SupabaseProvider) => void;
  error: (error: Error) => void;
};
/**
 * A Yjs provider that syncs document updates through Supabase Realtime.
 *
 * This provider enables real-time collaboration by broadcasting Yjs document
 * updates to other connected clients via Supabase Realtime channels.
 *
 * @example
 * ```typescript
 * const doc = new Y.Doc()
 * const supabase = createClient(url, key)
 * const provider = new SupabaseProvider('my-room', doc, supabase)
 *
 * provider.on('connect', () => console.log('Connected'))
 * provider.on('message', (update) => console.log('Received update'))
 * ```
 */
declare class SupabaseProvider {
  private channelName;
  private doc;
  private supabase;
  private channel;
  private status;
  private userId;
  private broadcastTimeout;
  private pendingUpdates;
  private options;
  private syncedPeers;
  private listeners;
  private reconnectAttempts;
  private reconnectTimeout;
  private shouldReconnect;
  constructor(channelName: string, doc: Y.Doc, supabase: SupabaseClient, options?: SupabaseProviderOptions);
  on<K extends keyof ProviderEventMap>(event: K, listener: ProviderEventMap[K]): this;
  off<K extends keyof ProviderEventMap>(event: K, listener: ProviderEventMap[K]): this;
  private emit;
  private setStatus;
  private broadcastUpdate;
  private queueBroadcast;
  private handleDocUpdate;
  private handleRemoteUpdate;
  /**
   * Sends our state vector to request missing updates from peers.
   */
  private sendStateVector;
  /**
   * Handles incoming state vector from a peer.
   * Computes the diff (what the peer is missing) and sends it.
   */
  private handleStateVector;
  /**
   * Connects to the Supabase Realtime channel and starts syncing.
   * Called automatically in the constructor. Can be called again to reconnect.
   */
  connect(): void;
  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private scheduleReconnect;
  /**
   * Disconnects from the channel and cleans up all resources.
   * Call this when the provider is no longer needed to prevent memory leaks.
   */
  destroy(): void;
  /**
   * Returns the current connection status.
   * @returns The current status: 'connecting', 'connected', or 'disconnected'
   */
  getStatus(): Status;
}
//#endregion
export { SupabaseProvider, type SupabaseProviderOptions };
//# sourceMappingURL=index.d.mts.map