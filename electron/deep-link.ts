export const pulseTrayProtocol = "pulsetray";

export interface FeedbackDeepLink {
  requesterId: string;
}

const employeeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const maximumDeepLinkLength = 2_048;

export function parseFeedbackDeepLink(input: string): FeedbackDeepLink | undefined {
  if (!input || input.length > maximumDeepLinkLength) return undefined;

  try {
    const url = new URL(input);
    const keys = [...url.searchParams.keys()];
    const requesterIds = url.searchParams.getAll("requester_id");
    if (
      url.protocol !== `${pulseTrayProtocol}:` ||
      url.hostname !== "feedback" ||
      url.pathname !== "/send" ||
      url.username ||
      url.password ||
      url.hash ||
      keys.some((key) => key !== "requester_id") ||
      requesterIds.length !== 1 ||
      !employeeIdPattern.test(requesterIds[0])
    ) {
      return undefined;
    }
    return { requesterId: requesterIds[0] };
  } catch {
    return undefined;
  }
}

export function feedbackDeepLinkFromArgs(args: readonly string[]): FeedbackDeepLink | undefined {
  for (const argument of args) {
    const parsed = parseFeedbackDeepLink(argument);
    if (parsed) return parsed;
  }
  return undefined;
}
