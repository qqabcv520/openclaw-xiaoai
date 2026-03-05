import { randomUUID } from "node:crypto";
import type {
  AppMessage,
  AppMessageType,
  EventMessage,
  RequestMessage,
  ResponseMessage,
  StreamMessage,
  StreamPayload,
} from "./types.js";

export const createId = () => randomUUID();

export const encodeAppMessage = (
  type: AppMessageType,
  payload: RequestMessage | ResponseMessage | EventMessage | StreamMessage
) => {
  if (type === "Request") {
    return JSON.stringify({ Request: payload as RequestMessage } satisfies AppMessage);
  }
  if (type === "Response") {
    return JSON.stringify({
      Response: payload as ResponseMessage,
    } satisfies AppMessage);
  }
  if (type === "Event") {
    return JSON.stringify({ Event: payload as EventMessage } satisfies AppMessage);
  }
  return JSON.stringify({ Stream: payload as StreamMessage } satisfies AppMessage);
};

export const parseAppMessage = (text: string) => {
  let data: AppMessage;
  try {
    data = JSON.parse(text) as AppMessage;
  } catch (_) {
    return null;
  }

  if ("Request" in data) {
    return { type: "Request" as const, payload: data.Request };
  }
  if ("Response" in data) {
    return { type: "Response" as const, payload: data.Response };
  }
  if ("Event" in data) {
    return { type: "Event" as const, payload: data.Event };
  }
  if ("Stream" in data) {
    return { type: "Stream" as const, payload: data.Stream };
  }
  return null;
};

export const encodeStream = (
  tag: string,
  bytes: Uint8Array,
  data?: unknown
) => {
  const payload: StreamMessage = {
    id: createId(),
    tag,
    bytes: Array.from(bytes),
    ...(data !== undefined ? { data } : {}),
  };
  return Buffer.from(JSON.stringify(payload));
};

export const decodeStream = (buffer: Buffer): StreamPayload | null => {
  try {
    const parsed = JSON.parse(buffer.toString("utf8")) as StreamMessage;
    if (!parsed?.id || !parsed?.tag || !Array.isArray(parsed.bytes)) {
      return null;
    }
    return {
      id: parsed.id,
      tag: parsed.tag,
      bytes: Uint8Array.from(parsed.bytes),
      data: parsed.data,
    };
  } catch (_) {
    return null;
  }
};
