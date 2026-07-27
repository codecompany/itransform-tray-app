import { describe, expect, it } from "vitest";
import {
  feedbackDeepLinkFromArgs,
  parseFeedbackDeepLink
} from "./deep-link";

describe("feedback deep links", () => {
  it("parses the feedback sender without accepting display data", () => {
    expect(parseFeedbackDeepLink(
      "pulsetray://feedback/send?requester_id=employee-123"
    )).toEqual({ requesterId: "employee-123" });
  });

  it.each([
    "",
    "https://feedback/send?requester_id=employee-123",
    "pulsetray://feedback/request?requester_id=employee-123",
    "pulsetray://feedback/send",
    "pulsetray://feedback/send?requester_id=",
    "pulsetray://feedback/send?requester_id=employee%20123",
    "pulsetray://feedback/send?requester_id=employee-1&requester_id=employee-2",
    "pulsetray://feedback/send?requester_id=employee-1&name=Marina",
    "pulsetray://user:password@feedback/send?requester_id=employee-1",
    "pulsetray://feedback/send?requester_id=employee-1#details"
  ])("rejects an unsupported or ambiguous URL: %s", (value) => {
    expect(parseFeedbackDeepLink(value)).toBeUndefined();
  });

  it("finds a valid deep link among operating-system arguments", () => {
    expect(feedbackDeepLinkFromArgs([
      "/Applications/iTransform Pulse.app/Contents/MacOS/iTransform Pulse",
      "--hidden",
      "pulsetray://feedback/send?requester_id=requester-9"
    ])).toEqual({ requesterId: "requester-9" });
  });

  it("ignores operating-system arguments without a supported deep link", () => {
    expect(feedbackDeepLinkFromArgs(["/Applications/iTransform Pulse", "--hidden"]))
      .toBeUndefined();
  });
});
