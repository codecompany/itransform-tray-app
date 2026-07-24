import type {
  DailyQuestion,
  EmployeeOption,
  EmployeeProfile,
  FeedbackDraft,
  FeedbackHistoryResult,
  FeedbackMethod
} from "../src/contracts.js";

interface EmployeeRecord {
  id: string;
  companyId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  position: string;
  managerId?: string;
  status?: string;
  startDate: string;
}

interface FeedbackRecord {
  id: string;
  from_employee_id: string;
  to_employee_id: string;
  method?: FeedbackMethod;
  content?: {
    context?: string;
    observed_behavior?: string;
    perceived_impact?: string;
    suggested_next_step?: string;
    continue_doing?: string;
    start_doing?: string;
    stop_doing?: string;
  };
  value: string;
  text: string;
  submitted_at: string;
  analysis?: {
    status?: "queued" | "completed" | "review_required" | "failed";
  };
}

export interface AccessTokenBundle {
  employeeId: string;
  employeeToken: string;
  knowledgeToken: string;
  pulseToken: string;
  expiresAt: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

function employeeName(employee: EmployeeRecord): string {
  return `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim() || employee.email;
}

export class PulseApiClient {
  constructor(private readonly baseUrl = process.env.PULSETRAY_API_URL ?? "https://api.storifly.ai") {}

  private async request<T>(path: string, token: string | undefined, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      signal: AbortSignal.timeout(12_000),
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers
      }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
      throw new ApiError(
        body.error || `A API iTransform Pulse respondeu ${response.status}.`,
        response.status,
        body.code
      );
    }
    return response.json() as Promise<T>;
  }

  async requestAccess(email: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("/v1/pulse/tray/access-requests", undefined, {
      method: "POST",
      body: JSON.stringify({ email })
    });
  }

  async exchangeTrayToken(token: string): Promise<AccessTokenBundle> {
    return this.request<AccessTokenBundle>("/v1/pulse/tray/session", undefined, {
      method: "POST",
      body: JSON.stringify({ token })
    });
  }

  private async listPages<T>(
    token: string,
    route: string,
    companyId: string,
    key: string
  ): Promise<T[]> {
    const items: T[] = [];
    let cursor = "";
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ companyId, limit: "500" });
      if (cursor) query.set("cursor", cursor);
      const result = await this.request<Record<string, unknown>>(`${route}?${query}`, token);
      const pageItems = result[key];
      if (Array.isArray(pageItems)) items.push(...pageItems as T[]);
      const next = String(result.nextCursor ?? "");
      if (!next || next === "0" || next === cursor) break;
      cursor = next;
    }
    return items;
  }

  async link(token: string, employeeId?: string): Promise<EmployeeProfile> {
    const normalizedEmployeeId = employeeId?.trim() ?? "";
    if (!normalizedEmployeeId) {
      throw new ApiError(
        "A sessão não contém o Employee ID necessário para concluir a vinculação.",
        400,
        "SESSION_IDENTITY_MISSING"
      );
    }

    const employee = await this.request<EmployeeRecord>(
      `/v1/employees/${encodeURIComponent(normalizedEmployeeId)}`,
      token
    );
    let managerName: string | undefined;
    if (employee.managerId) {
      const manager = await this.request<EmployeeRecord>(
        `/v1/employees/${encodeURIComponent(employee.managerId)}`,
        token
      ).catch(() => undefined);
      managerName = manager ? employeeName(manager) : undefined;
    }
    return {
      id: employee.id,
      companyId: employee.companyId,
      userId: employee.userId,
      name: employeeName(employee),
      email: employee.email,
      position: employee.position,
      managerId: employee.managerId,
      managerName,
      startDate: employee.startDate
    };
  }

  async getQuestion(token: string, employeeId: string): Promise<DailyQuestion | null> {
    try {
      const question = await this.request<Omit<DailyQuestion, "answerStatus"> & { answered?: boolean }>(
        `/v1/pulse/question/${encodeURIComponent(employeeId)}`,
        token
      );
      const answered = question.answered === true;
      return {
        ...question,
        answered,
        answerStatus: answered ? "external" : "unanswered"
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async submitAnswer(token: string, employeeId: string, questionId: string, value: string): Promise<void> {
    await this.request<{ status: string }>(`/v1/pulse/answer/${encodeURIComponent(employeeId)}`, token, {
      method: "POST",
      body: JSON.stringify({ questionId, value })
    });
  }

  async listEmployees(token: string, companyId: string): Promise<EmployeeOption[]> {
    const normalizedCompanyId = companyId.trim();
    if (!normalizedCompanyId) {
      throw new ApiError(
        "A sessão não contém a empresa necessária para listar colaboradores.",
        400,
        "COMPANY_ID_MISSING"
      );
    }
    const employees = await this.listPages<EmployeeRecord>(
      token,
      "/v1/employees/list",
      normalizedCompanyId,
      "employees"
    );
    return employees
      .filter((employee) => !employee.status || employee.status.trim().toLowerCase() === "active")
      .map((employee) => ({
        id: employee.id,
        name: employeeName(employee),
        email: employee.email,
        position: employee.position
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  async hasDirectReports(
    token: string,
    companyId: string,
    employeeId: string
  ): Promise<boolean> {
    let cursor = "";
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ companyId, limit: "500" });
      if (cursor) query.set("cursor", cursor);
      const result = await this.request<Record<string, unknown>>(
        `/v1/employees/list?${query}`,
        token
      );
      const employees = Array.isArray(result.employees)
        ? result.employees as EmployeeRecord[]
        : [];
      if (employees.some((employee) =>
        (!employee.status || employee.status.trim().toLowerCase() === "active") &&
        employee.managerId === employeeId
      )) return true;
      const next = String(result.nextCursor ?? "");
      if (!next || next === "0" || next === cursor) return false;
      cursor = next;
    }
    return false;
  }

  async sendFeedback(
    tokens: AccessTokenBundle,
    profile: EmployeeProfile,
    draft: FeedbackDraft
  ): Promise<void> {
    try {
      await this.request<{ status: string; id: string }>(
        "/v1/pulse/feedbacks",
        tokens.pulseToken,
        {
          method: "POST",
          headers: {
            "X-PulseTray-Employee-Token": tokens.employeeToken,
            "X-PulseTray-Knowledge-Token": tokens.knowledgeToken
          },
          body: JSON.stringify({
            company_id: profile.companyId,
            from_employee_id: profile.id,
            to_employee_id: draft.toEmployeeId,
            method: draft.method,
            value: String(draft.importance),
            content: {
              context: draft.content.context.trim(),
              observed_behavior: draft.content.observedBehavior.trim(),
              perceived_impact: draft.content.perceivedImpact.trim(),
              suggested_next_step: draft.content.suggestedNextStep.trim(),
              continue_doing: draft.content.continueDoing.trim(),
              start_doing: draft.content.startDoing.trim(),
              stop_doing: draft.content.stopDoing.trim()
            }
          })
        }
      );
    } catch (error) {
      if (error instanceof ApiError && error.message === "invalid feedback target") {
        throw new Error(
          "O colaborador selecionado não pôde ser validado. Atualize a lista e tente novamente."
        );
      }
      throw error;
    }
  }

  async listFeedbackHistory(
    tokens: AccessTokenBundle,
    profile: EmployeeProfile,
    direction: "sent" | "received"
  ): Promise<FeedbackHistoryResult> {
    const result = await this.request<{ feedbacks?: FeedbackRecord[] }>(
      `/v1/pulse/feedbacks/${encodeURIComponent(profile.id)}?direction=${direction}`,
      tokens.pulseToken,
      {
        headers: {
          "X-PulseTray-Employee-Token": tokens.employeeToken
        }
      }
    );
    // History remains useful during an Employee directory outage; names are
    // optional presentation data, while the Pulse response is authoritative.
    const employees = await this.listEmployees(tokens.employeeToken, profile.companyId)
      .catch(() => []);
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    return {
      feedbacks: (result.feedbacks ?? []).map((feedback) => {
        const personId = direction === "sent"
          ? feedback.to_employee_id
          : feedback.from_employee_id;
        const person = employeeById.get(personId);
        return {
          id: feedback.id,
          person: person?.name ?? "Colaborador",
          personEmail: person?.email,
          date: feedback.submitted_at,
          importance: Number(feedback.value) || 3,
          method: feedback.method ?? "legacy",
          content: {
            context: feedback.content?.context ?? "",
            observedBehavior: feedback.content?.observed_behavior ?? "",
            perceivedImpact: feedback.content?.perceived_impact ?? "",
            suggestedNextStep: feedback.content?.suggested_next_step ?? "",
            continueDoing: feedback.content?.continue_doing ?? "",
            startDoing: feedback.content?.start_doing ?? "",
            stopDoing: feedback.content?.stop_doing ?? ""
          },
          message: feedback.text,
          analysisStatus: feedback.analysis?.status
        };
      })
    };
  }
}
