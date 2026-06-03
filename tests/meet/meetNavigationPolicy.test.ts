import { meetNavigationActionFor } from "@main/meet/meetNavigationPolicy";
import { describe, expect, it } from "vitest";

describe("meetNavigationActionFor", () => {
  it("allows Google Meet and Google auth navigation in the embedded Meet view", () => {
    expect(meetNavigationActionFor("https://meet.google.com/abc-defg-hij")).toEqual({
      type: "allow",
    });
    expect(meetNavigationActionFor("https://accounts.google.com/signin")).toEqual({
      type: "allow",
    });
    expect(meetNavigationActionFor("https://ssl.gstatic.com/accounts/static.css")).toEqual({
      type: "allow",
    });
  });

  it("opens safe external targets outside the embedded Meet view", () => {
    expect(meetNavigationActionFor("https://calendar.google.com/calendar/u/0/r")).toEqual({
      type: "openExternal",
      url: "https://calendar.google.com/calendar/u/0/r",
    });
    expect(meetNavigationActionFor("mailto:hello@example.com")).toEqual({
      type: "openExternal",
      url: "mailto:hello@example.com",
    });
    expect(meetNavigationActionFor("tel:+81312345678")).toEqual({
      type: "openExternal",
      url: "tel:+81312345678",
    });
  });

  it("blocks unsafe or ambiguous navigation targets", () => {
    expect(meetNavigationActionFor("http://meet.google.com/abc-defg-hij")).toEqual({
      type: "block",
    });
    expect(meetNavigationActionFor("file:///Users/example/secret")).toEqual({
      type: "block",
    });
    expect(meetNavigationActionFor("javascript:alert(1)")).toEqual({
      type: "block",
    });
    expect(meetNavigationActionFor("not a url")).toEqual({ type: "block" });
  });
});
