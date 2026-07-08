import { describe, it, expect, beforeEach } from "bun:test";
import { DriveModeStore } from "./store.js";

describe("DriveModeStore", () => {
  let store: DriveModeStore;
  beforeEach(() => {
    store = new DriveModeStore();
  });

  it("defaults an unseen session to collab", () => {
    expect(store.get("s1")).toBe("collab");
  });

  it("returns a mode that was set", () => {
    store.set("s1", "auto");
    expect(store.get("s1")).toBe("auto");
  });

  it("isolates modes between sessions", () => {
    store.set("s1", "auto");
    expect(store.get("s2")).toBe("collab");
  });

  it("clear resets a session back to the default", () => {
    store.set("s1", "auto");
    store.clear("s1");
    expect(store.get("s1")).toBe("collab");
  });

  it("last write wins for the same session", () => {
    store.set("s1", "auto");
    store.set("s1", "collab");
    expect(store.get("s1")).toBe("collab");
  });
});
