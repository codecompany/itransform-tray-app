export type AppView =
  | "question"
  | "feedback"
  | "received"
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
}

export interface SessionView {
  linked: boolean;
  configured: boolean;
  profile?: EmployeeProfile;
  dailyTime?: string;
  lastAnswerDate?: string;
  events: ActivityEvent[];
  receivedFeedbackAvailable: boolean;
}

export interface QuestionChoice {
  value: string;
  label: string;
}

export interface DailyQuestion {
  employeeId: string;
  date: string;
  question: {
    id: string;
    text: string;
    choices: QuestionChoice[];
  };
  answered: boolean;
}

export interface EmployeeOption {
  id: string;
  name: string;
  email: string;
  position: string;
}

export interface FeedbackDimension {
  id: string;
  indexId: string;
  indexKey: "IPT" | "IAT" | string;
  name: string;
  parentId?: string;
}

export interface FeedbackIndex {
  id: string;
  key: "IPT" | "IAT" | string;
  description: string;
}

export interface FeedbackTaxonomy {
  indexes: FeedbackIndex[];
  dimensions: FeedbackDimension[];
}

export interface FeedbackDraft {
  toEmployeeId: string;
  indexId: string;
  dimensionId: string;
  subDimensionId: string;
  importance: number;
  message: string;
}

export interface ReceivedFeedback {
  id: string;
  sender?: string;
  date: string;
  subDimension: string;
  importance: number;
  message: string;
}

export interface ReceivedFeedbackResult {
  available: boolean;
  feedbacks: ReceivedFeedback[];
  message?: string;
}

export interface PulseTrayApi {
  bootstrap(): Promise<SessionView>;
  requestAccess(email: string): Promise<{ message: string }>;
  link(token: string): Promise<SessionView>;
  saveDailyTime(time: string): Promise<SessionView>;
  getQuestion(): Promise<DailyQuestion | null>;
  submitAnswer(input: { questionId: string; value: string; date: string }): Promise<SessionView>;
  listEmployees(): Promise<EmployeeOption[]>;
  listFeedbackTaxonomy(): Promise<FeedbackTaxonomy>;
  sendFeedback(draft: FeedbackDraft): Promise<void>;
  listReceivedFeedback(): Promise<ReceivedFeedbackResult>;
  logout(): Promise<SessionView>;
  onNavigate(callback: (view: AppView, required: boolean) => void): () => void;
}
