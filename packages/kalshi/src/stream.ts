import WebSocket from "ws";
import { signRequest } from "./auth.ts";
import { loadKalshiPrivateKey, parseKalshiConfig } from "./config.ts";
import {
  parseMarketMessage,
  SequenceTracker,
  type MarketMessage,
} from "./messages.ts";
import { text } from "./market-data.ts";

export function reconnectDelay(attempt: number, random = Math.random): number {
  return Math.min(
    30_000,
    Math.round(
      Math.min(30_000, 1000 * 2 ** Math.min(Math.max(0, attempt), 5)) *
        (0.8 + random() * 0.2),
    ),
  );
}
export interface StreamCallbacks {
  onMessage: (event: MarketMessage, receivedAt: Date) => boolean;
  onConnection: (connected: boolean) => void;
  onWarning: (code: string) => void;
}

/** Only this fixed DEMO host is ever signed. No arbitrary commands are exposed. */
export function createDemoMarketStream(
  tickers: string[],
  callbacks: StreamCallbacks,
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = parseKalshiConfig(env);
  const key = loadKalshiPrivateKey(config.privateKeyPath);
  const universe = [...new Set(tickers.map(text))];
  if (!universe.length || universe.length > 100)
    throw new Error("Stream requires 1-100 markets.");
  let socket: WebSocket | undefined;
  let stopped = false;
  let retryTimer: NodeJS.Timeout | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let resnapshot: NodeJS.Timeout | undefined;
  let attempt = 0;
  let reconnects = 0;
  let malformedMessages = 0;
  let lastActivity = Date.now();

  const clearTimers = () => {
    clearInterval(heartbeat);
    clearInterval(resnapshot);
  };
  const connect = () => {
    if (stopped) return;
    const timestamp = String(Date.now());
    const openedAt = Date.now();
    const sequences = new SequenceTracker();
    const channels = new Set<string>();
    let bookSid: number | undefined;
    let commandId = 10;
    lastActivity = Date.now();
    const current = new WebSocket(
      "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2",
      {
        headers: {
          "KALSHI-ACCESS-KEY": config.apiKeyId,
          "KALSHI-ACCESS-TIMESTAMP": timestamp,
          "KALSHI-ACCESS-SIGNATURE": signRequest(
            key,
            timestamp,
            "GET",
            "/trade-api/ws/v2",
          ),
        },
        followRedirects: false,
        handshakeTimeout: 15_000,
        maxPayload: 2 * 1024 * 1024,
      },
    );
    socket = current;
    const activity = () => {
      lastActivity = Date.now();
    };
    current.on("ping", activity); // ws automatically returns Pong control frames.
    current.on("pong", activity);
    current.on("open", () => {
      if (stopped) {
        current.close();
        return;
      }
      callbacks.onConnection(true);
      for (const [id, channel] of [
        "ticker",
        "orderbook_delta",
        "trade",
      ].entries()) {
        current.send(
          JSON.stringify({
            id: id + 1,
            cmd: "subscribe",
            params: { channels: [channel], market_tickers: universe },
          }),
        );
      }
      heartbeat = setInterval(() => {
        if (
          Date.now() - lastActivity > 35_000 ||
          (channels.size < 3 && Date.now() - openedAt > 20_000)
        ) {
          callbacks.onWarning("stale_connection_or_subscription");
          current.terminate();
        } else if (current.readyState === WebSocket.OPEN) current.ping();
      }, 10_000);
      resnapshot = setInterval(() => {
        if (bookSid !== undefined && current.readyState === WebSocket.OPEN)
          current.send(
            JSON.stringify({
              id: commandId++,
              cmd: "update_subscription",
              params: {
                sids: [bookSid],
                market_tickers: universe,
                action: "get_snapshot",
              },
            }),
          );
      }, 60_000);
    });
    current.on("message", (data) => {
      if (stopped || current !== socket) return;
      activity();
      const parsed = parseMarketMessage(data.toString());
      if (parsed.kind === "subscribed") {
        channels.add(parsed.channel);
        if (parsed.channel === "orderbook_delta") bookSid = parsed.sid;
      } else if (parsed.kind === "malformed") {
        malformedMessages++;
        if (parsed.bookUnsafe) {
          callbacks.onWarning("malformed_orderbook");
          current.terminate();
        }
      } else if (parsed.kind === "error") {
        callbacks.onWarning(`subscription_error_${parsed.code}`);
        current.terminate();
      } else if (parsed.kind === "event") {
        const event = parsed.event;
        if ("sid" in event) {
          const result = sequences.accept(event.sid, event.seq);
          if (result === "duplicate") return;
          if (result === "gap") {
            callbacks.onWarning("sequence_gap");
            current.terminate();
            return;
          }
        }
        if (!callbacks.onMessage(event, new Date())) {
          callbacks.onWarning("unsafe_orderbook_state");
          current.terminate();
        }
      }
    });
    current.on("error", () => callbacks.onWarning("websocket_transport_error"));
    current.on("close", () => {
      clearTimers();
      callbacks.onConnection(false);
      if (stopped) return;
      if (Date.now() - openedAt >= 60_000) attempt = 0;
      reconnects++;
      retryTimer = setTimeout(connect, reconnectDelay(attempt++));
    });
  };
  return {
    start: connect,
    reconnect: () => socket?.terminate(),
    health: () => ({
      reconnects,
      malformedMessages,
      connectionActivityAgeMs: Date.now() - lastActivity,
    }),
    async stop(): Promise<void> {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimers();
      if (!socket || socket.readyState === WebSocket.CLOSED) return;
      const current = socket;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          current.terminate();
          resolve();
        }, 2000);
        current.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
        if (current.readyState === WebSocket.CONNECTING) current.terminate();
        else current.close(1000, "Recorder shutdown");
      });
    },
  };
}
