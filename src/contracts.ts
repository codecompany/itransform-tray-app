export type AppView =
  | "question"
  | "feedbacks"
  | "settings";

export type EventKind = "system" | "feedback-sent" | "feedback-received";

export interface ActivityEvent {
  id: string;
  kind: EventKind;
  title: string;
  detail: string;
  at: string;
}

export interface EmployeeProfile {
  id: string;
  companyId: string;
  userId: string;
  name: string;
  email: string;
  position: string;
  managerId?: string;
  managerName?: string;
  startDate: string;
  isLeader?: boolean;
}

export interface QuietHoursWindow {
  start: string;
  end: string;
}

export interface SessionView {
  linked: boolean;
  configured: boolean;
  profile?: EmployeeProfile;
  lastAnswerDate?: string;
  events: ActivityEvent[];
  receivedFeedbackAvailable: boolean;
  quietHours: QuietHoursWindow[];
}

export interface QuestionChoice {
  value: string;
  label: string;
}

export type AnswerStatus = "unanswered" | "pending-sync" | "synced" | "external";

export interface DailyQuestion {
  employeeId: string;
  date: string;
  question: {
    id: string;
    text: string;
    choices: QuestionChoice[];
  };
  answered: boolean;
  answerStatus: AnswerStatus;
}

export interface EmployeeOption {
  id: string;
  name: string;
  email: string;
  position: string;
}

export type FeedbackMethod = "situational" | "development";

export interface FeedbackContent {
  context: string;
  observedBehavior: string;
  perceivedImpact: string;
  suggestedNextStep: string;
  continueDoing: string;
  startDoing: string;
  stopDoing: string;
}

export interface FeedbackDraft {
  toEmployeeId: string;
  method: FeedbackMethod | "";
  importance: number;
  content: FeedbackContent;
}

export interface FeedbackHistoryItem {
  id: string;
  person: string;
  personEmail?: string;
  date: string;
  importance: number;
  method: FeedbackMethod | "legacy";
  content: FeedbackContent;
  message: string;
  analysisStatus?: "queued" | "completed" | "review_required" | "failed";
}

export interface FeedbackHistoryResult {
  feedbacks: FeedbackHistoryItem[];
}

export interface PulseTrayApi {
  bootstrap(): Promise<SessionView>;
  requestAccess(email: string): Promise<{ message: string }>;
  link(token: string): Promise<SessionView>;
  getQuestion(): Promise<DailyQuestion | null>;
  submitAnswer(input: { questionId: string; value: string; date: string }): Promise<SessionView>;
  skipQuestion(): Promise<SessionView>;
  listEmployees(): Promise<EmployeeOption[]>;
  sendFeedback(draft: FeedbackDraft): Promise<SessionView>;
  listFeedbackHistory(direction: "sent" | "received"): Promise<FeedbackHistoryResult>;
  saveQuietHours(windows: QuietHoursWindow[]): Promise<SessionView>;
  openManagerHub(): Promise<void>;
  openFeedbacks(): Promise<void>;
  dismissQuestion(): Promise<void>;
  logout(): Promise<SessionView>;
  onNavigate(callback: (view: AppView, required: boolean) => void): () => void;
}
