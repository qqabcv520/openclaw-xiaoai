export interface RequestMessage {
  id: string;
  command: string;
  payload?: unknown;
}

export interface ResponseMessage {
  id: string;
  code?: number;
  msg?: string;
  data?: unknown;
}

export interface EventMessage {
  id: string;
  event: string;
  data?: unknown;
}

export interface StreamMessage {
  id: string;
  tag: string;
  bytes: number[];
  data?: unknown;
}

export type AppMessage =
  | { Request: RequestMessage }
  | { Response: ResponseMessage }
  | { Event: EventMessage }
  | { Stream: StreamMessage };

export type AppMessageType = "Request" | "Response" | "Event" | "Stream";

export interface StreamPayload {
  id: string;
  tag: string;
  bytes: Uint8Array;
  data?: unknown;
}
