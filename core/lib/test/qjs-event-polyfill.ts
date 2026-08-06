/** Minimal EventTarget/Event stub so chai's plugin bus can load under
 *  QuickJS. Side-effect-only; import before chai. */
const globalWithEventApis = globalThis as {
  Event?: unknown;
  EventTarget?: unknown;
};

globalWithEventApis.Event ??= class Event {
  type: string;
  constructor(type: string) {
    this.type = type;
  }
};

globalWithEventApis.EventTarget ??= class EventTarget {
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }
};
