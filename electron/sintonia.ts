import type {
  DailyQuestion,
  EmployeeOption,
  EmployeeProfile,
  FeedbackDimension,
  FeedbackDraft
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

interface DimensionRecord {
  id: string;
  indexId: string;
  name: string;
  parentId?: string;
}

interface IndexRecord {
  id: string;
  key: string;
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

function tokenClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function firstClaim(claims: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function employeeName(employee: EmployeeRecord): string {
  return `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim() || employee.email;
}

export class SintoniaClient {
  constructor(private readonly baseUrl = process.env.PULSETRAY_API_URL ?? "https://api.storifly.ai") {}

  private async request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      signal: AbortSignal.timeout(12_000),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers
      }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
      throw new ApiError(body.error || `A API Sintonia respondeu ${response.status}.`, response.status, body.code);
    }
    return response.json() as Promise<T>;
  }

  private async listPages<T>(
    token: string,
    route: string,
    companyId: string,
    key: "employees" | "dimensions" | "indexes"
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

  async link(token: string): Promise<EmployeeProfile> {
    const claims = tokenClaims(token);
    const email = firstClaim(claims, ["email", "userEmail", "email_address", "preferred_username", "upn"]);
    const employeeId = firstClaim(claims, ["employeeId", "employee_id"]);
    if (!email && !employeeId) {
      throw new ApiError(
        "O token não contém o e-mail ou Employee ID necessário para concluir a vinculação.",
        400,
        "TOKEN_IDENTITY_MISSING"
      );
    }

    const employee = email
      ? await this.request<EmployeeRecord>(`/v1/employees/email/${encodeURIComponent(email)}`, token)
      : await this.request<EmployeeRecord>(`/v1/employees/${encodeURIComponent(employeeId)}`, token);
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

  async getQuestion(token: string, employeeId: string): Promise<Omit<DailyQuestion, "answered"> | null> {
    try {
      return await this.request<Omit<DailyQuestion, "answered">>(
        `/v1/pulse/question/${encodeURIComponent(employeeId)}`,
        token
      );
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
    const employees = await this.listPages<EmployeeRecord>(token, "/v1/employees/list", companyId, "employees");
    return employees
      .filter((employee) => !employee.status || employee.status === "active")
      .map((employee) => ({
        id: employee.id,
        name: employeeName(employee),
        email: employee.email,
        position: employee.position
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  async listFeedbackDimensions(token: string, companyId: string): Promise<FeedbackDimension[]> {
    const [dimensions, indexes] = await Promise.all([
      this.listPages<DimensionRecord>(token, "/v1/dimensions/list", companyId, "dimensions"),
      this.listPages<IndexRecord>(token, "/v1/indexes/list", companyId, "indexes")
    ]);
    const indexById = new Map(indexes.map((index) => [index.id, index.key]));
    return dimensions
      .filter((dimension) => Boolean(dimension.parentId))
      .map((dimension) => ({
        ...dimension,
        indexKey: indexById.get(dimension.indexId) ?? ""
      }))
      .filter((dimension) => dimension.indexKey === "IPT" || dimension.indexKey === "IAT")
      .sort((a, b) => a.indexKey.localeCompare(b.indexKey) || a.name.localeCompare(b.name, "pt-BR"));
  }

  async sendFeedback(
    token: string,
    profile: EmployeeProfile,
    draft: FeedbackDraft,
    dimension: FeedbackDimension
  ): Promise<void> {
    await this.request<{ status: string; id: string }>("/v1/pulse/feedbacks", token, {
      method: "POST",
      body: JSON.stringify({
        company_id: profile.companyId,
        from_employee_id: profile.id,
        to_employee_id: draft.toEmployeeId,
        dimension_id: dimension.parentId,
        sub_dimension_id: dimension.id,
        index_id: dimension.indexId,
        value: String(draft.importance),
        text: draft.message.trim(),
        submitted_at: new Date().toISOString()
      })
    });
  }
}
