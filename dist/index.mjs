import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import * as Y from "yjs";

//#region src/SupabaseProvider.ts
const UPDATE_EVENT = "y-supabase-update";
const STATE_VECTOR_EVENT = "y-supabase-state-vector";
const encodeUpdate = (update) => {
	let binary = "";
	const chunkSize = 32768;
	for (let i = 0; i < update.length; i += chunkSize) binary += String.fromCharCode.apply(null, Array.from(update.subarray(i, i + chunkSize)));
	return btoa(binary);
};
const decodeUpdate = (encoded) => {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
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
var SupabaseProvider = class {
	constructor(channelName, doc, supabase, options) {
		this.channel = null;
		this.status = "connecting";
		this.broadcastTimeout = null;
		this.pendingUpdates = [];
		this.syncedPeers = /* @__PURE__ */ new Set();
		this.listeners = /* @__PURE__ */ new Map();
		this.reconnectAttempts = 0;
		this.reconnectTimeout = null;
		this.shouldReconnect = true;
		this.channelName = channelName;
		this.doc = doc;
		this.supabase = supabase;
		this.options = options;
		this.userId = crypto.randomUUID();
		this.handleDocUpdate = this.handleDocUpdate.bind(this);
		this.connect();
	}
	on(event, listener) {
		if (!this.listeners.has(event)) this.listeners.set(event, /* @__PURE__ */ new Set());
		this.listeners.get(event).add(listener);
		return this;
	}
	off(event, listener) {
		this.listeners.get(event)?.delete(listener);
		return this;
	}
	emit(event, ...args) {
		const eventListeners = this.listeners.get(event);
		if (eventListeners) eventListeners.forEach((listener) => {
			listener(...args);
		});
	}
	setStatus(next) {
		this.status = next;
		this.emit("status", next);
	}
	broadcastUpdate(update, event = UPDATE_EVENT) {
		if (!this.channel) return;
		const payload = {
			update: encodeUpdate(update),
			user: { id: this.userId },
			timestamp: Date.now()
		};
		this.channel.send({
			type: "broadcast",
			event,
			payload
		});
	}
	queueBroadcast(update) {
		const throttle = this.options?.broadcastThrottleMs ?? 0;
		if (throttle <= 0) {
			this.broadcastUpdate(update);
			return;
		}
		this.pendingUpdates.push(update);
		if (this.broadcastTimeout) return;
		this.broadcastTimeout = setTimeout(() => {
			this.broadcastTimeout = null;
			if (this.pendingUpdates.length === 0) return;
			const mergedUpdate = this.pendingUpdates.length === 1 ? this.pendingUpdates[0] : Y.mergeUpdates(this.pendingUpdates);
			this.pendingUpdates = [];
			this.broadcastUpdate(mergedUpdate);
		}, throttle);
	}
	handleDocUpdate(update, origin) {
		if (origin === "remote") return;
		this.queueBroadcast(update);
	}
	handleRemoteUpdate(payload) {
		if (payload.user.id === this.userId) return;
		try {
			const update = decodeUpdate(payload.update);
			Y.applyUpdate(this.doc, update, "remote");
			this.emit("message", update);
		} catch (err) {
			this.emit("error", err instanceof Error ? err : /* @__PURE__ */ new Error("Failed to apply remote update"));
		}
	}
	/**
	* Sends our state vector to request missing updates from peers.
	*/
	sendStateVector() {
		if (!this.channel) return;
		const payload = {
			stateVector: encodeUpdate(Y.encodeStateVector(this.doc)),
			user: { id: this.userId },
			timestamp: Date.now()
		};
		this.channel.send({
			type: "broadcast",
			event: STATE_VECTOR_EVENT,
			payload
		});
	}
	/**
	* Handles incoming state vector from a peer.
	* Computes the diff (what the peer is missing) and sends it.
	*/
	handleStateVector(payload) {
		if (payload.user.id === this.userId) return;
		if (this.syncedPeers.has(payload.user.id)) return;
		this.syncedPeers.add(payload.user.id);
		try {
			const remoteStateVector = decodeUpdate(payload.stateVector);
			const diff = Y.encodeStateAsUpdate(this.doc, remoteStateVector);
			if (diff.length > 2) this.broadcastUpdate(diff);
			this.sendStateVector();
		} catch (err) {
			this.emit("error", err instanceof Error ? err : /* @__PURE__ */ new Error("Failed to handle state vector"));
		}
	}
	/**
	* Connects to the Supabase Realtime channel and starts syncing.
	* Called automatically in the constructor. Can be called again to reconnect.
	*/
	connect() {
		this.shouldReconnect = true;
		this.doc.off("update", this.handleDocUpdate);
		this.doc.on("update", this.handleDocUpdate);
		this.syncedPeers.clear();
		this.channel = this.supabase.channel(this.channelName);
		this.channel.on("broadcast", { event: STATE_VECTOR_EVENT }, (data) => {
			this.handleStateVector(data.payload);
		}).on("broadcast", { event: UPDATE_EVENT }, (data) => {
			this.handleRemoteUpdate(data.payload);
		}).subscribe((status, err) => {
			if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
				this.setStatus("connected");
				this.emit("connect", this);
				this.reconnectAttempts = 0;
				this.sendStateVector();
			} else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
				this.setStatus("disconnected");
				this.emit("error", err ?? /* @__PURE__ */ new Error("Channel error"));
				this.emit("disconnect", this);
				this.scheduleReconnect();
			} else if (status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT) {
				this.setStatus("disconnected");
				this.emit("error", /* @__PURE__ */ new Error("Connection timed out"));
				this.emit("disconnect", this);
				this.scheduleReconnect();
			} else if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
				this.setStatus("disconnected");
				this.emit("disconnect", this);
				this.scheduleReconnect();
			}
		});
	}
	/**
	* Schedule a reconnection attempt with exponential backoff.
	*/
	scheduleReconnect() {
		const autoReconnect = this.options?.autoReconnect ?? true;
		const maxAttempts = this.options?.maxReconnectAttempts ?? Infinity;
		if (!autoReconnect || !this.shouldReconnect || this.reconnectAttempts >= maxAttempts) return;
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}
		const baseDelay = this.options?.reconnectDelay ?? 1e3;
		const maxDelay = this.options?.maxReconnectDelay ?? 3e4;
		const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), maxDelay);
		this.reconnectAttempts++;
		this.reconnectTimeout = setTimeout(() => {
			if (this.shouldReconnect) this.connect();
		}, delay);
	}
	/**
	* Disconnects from the channel and cleans up all resources.
	* Call this when the provider is no longer needed to prevent memory leaks.
	*/
	destroy() {
		this.shouldReconnect = false;
		if (this.broadcastTimeout) {
			clearTimeout(this.broadcastTimeout);
			this.broadcastTimeout = null;
		}
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}
		this.doc.off("update", this.handleDocUpdate);
		if (this.channel) {
			this.supabase.removeChannel(this.channel);
			this.channel = null;
		}
	}
	/**
	* Returns the current connection status.
	* @returns The current status: 'connecting', 'connected', or 'disconnected'
	*/
	getStatus() {
		return this.status;
	}
};

//#endregion
export { SupabaseProvider };
//# sourceMappingURL=index.mjs.map