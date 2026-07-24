import type {
  DailyQuestion,
  EmployeeOption,
  EmployeeProfile,
  FeedbackDimension,
  FeedbackDraft,
  FeedbackTaxonomy
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
  description?: string;
}

export interface AccessTokenBundle {
  employeeId: string;
  employeeToken: string;
  knowledgeToken: string;
  pulseToken: string;
  expiresAt: string;
}

export function validateFeedbackSelection(
  draft: FeedbackDraft,
  taxonomy: FeedbackTaxonomy
): {
  index: FeedbackTaxonomy["indexes"][number];
  dimension: FeedbackDimension;
  subDimension: FeedbackDimension;
} {
  const index = taxonomy.indexes.find((item) => item.id === draft.indexId);
  const dimension = taxonomy.dimensions.find((item) =>
    item.id === draft.dimensionId &&
    item.indexId === draft.indexId &&
    !item.parentId
  );
  const subDimension = taxonomy.dimensions.find((item) =>
    item.id === draft.subDimensionId &&
    item.indexId === draft.indexId &&
    item.parentId === draft.dimensionId
  );
  if (!index || !dimension || !subDimension) {
    throw new Error(
      "Seleção de índice, dimensão ou subdimensão inválida. Escolha novamente."
    );
  }
  return { index, dimension, subDimension };
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

  async listFeedbackTaxonomy(token: string, companyId: string): Promise<FeedbackTaxonomy> {
    const [dimensions, indexes] = await Promise.all([
      this.listPages<DimensionRecord>(token, "/v1/dimensions/list", companyId, "dimensions"),
      this.listPages<IndexRecord>(token, "/v1/indexes/list", companyId, "indexes")
    ]);
    const supportedIndexes = indexes
      .map((index) => ({
        id: index.id,
        key: index.key.trim().toUpperCase(),
        description: index.description?.trim() ?? ""
      }))
      .filter((index) => index.key === "IPT" || index.key === "IAT")
      .sort((a, b) => ["IPT", "IAT"].indexOf(a.key) - ["IPT", "IAT"].indexOf(b.key));
    const indexById = new Map(supportedIndexes.map((index) => [index.id, index.key]));
    const feedbackDimensions = dimensions
      .filter((dimension) => indexById.has(dimension.indexId))
      .map((dimension) => ({
        ...dimension,
        indexKey: indexById.get(dimension.indexId) ?? ""
      }))
      .sort((a, b) =>
        a.indexKey.localeCompare(b.indexKey) ||
        Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) ||
        a.name.localeCompare(b.name, "pt-BR")
      );
    return { indexes: supportedIndexes, dimensions: feedbackDimensions };
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
            dimension_id: draft.dimensionId,
            sub_dimension_id: draft.subDimensionId,
            index_id: draft.indexId,
            value: String(draft.importance),
            text: draft.message.trim(),
            submitted_at: new Date().toISOString()
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
}
