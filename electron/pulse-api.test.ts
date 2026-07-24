import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, PulseApiClient } from "./pulse-api";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("PulseApiClient", () => {
  it("requests and exchanges the durable tray token without an Authorization header", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ message: "E-mail aceito." }, 202))
      .mockResolvedValueOnce(response({
        employeeId: "employee-1",
        employeeToken: "employee",
        knowledgeToken: "knowledge",
        pulseToken: "pulse",
        expiresAt: "2026-07-23T22:00:00Z"
      }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new PulseApiClient("https://example.test");

    await expect(client.requestAccess("ana@example.com")).resolves.toEqual({ message: "E-mail aceito." });
    await expect(client.exchangeTrayToken("pt_live_token")).resolves.toMatchObject({
      employeeId: "employee-1",
      pulseToken: "pulse"
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/pulse/tray/access-requests");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ email: "ana@example.com" }));
    expect(fetchMock.mock.calls[1][0]).toBe("https://example.test/v1/pulse/tray/session");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ token: "pt_live_token" }));
  });

  it("resolves the employee and manager from the session employee ID", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        id: "employee-1",
        companyId: "company-1",
        userId: "user-1",
        firstName: "Ana",
        lastName: "Silva",
        email: "ana@example.com",
        position: "Designer",
        managerId: "manager-1",
        startDate: "2025-01-02T00:00:00Z"
      }))
      .mockResolvedValueOnce(response({
        id: "manager-1",
        companyId: "company-1",
        userId: "manager-user",
        firstName: "Caio",
        lastName: "Souza",
        email: "caio@example.com",
        position: "Head",
        startDate: "2024-01-02T00:00:00Z"
      }));
    vi.stubGlobal("fetch", fetchMock);

    const profile = await new PulseApiClient("https://example.test").link("employee-token", "employee-1");
    expect(profile).toMatchObject({ id: "employee-1", name: "Ana Silva", managerName: "Caio Souza" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/employees/employee-1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toContain("Bearer ");
  });

  it("rejects a session without an employee ID", async () => {
    await expect(new PulseApiClient().link("employee-token", undefined)).rejects.toMatchObject({
      code: "SESSION_IDENTITY_MISSING",
      status: 400
    });
  });

  it("links by employeeId and tolerates missing manager details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      id: "employee-2",
      companyId: "company-1",
      userId: "user-2",
      firstName: "",
      lastName: "",
      email: "fallback@example.com",
      position: "Analista",
      startDate: "2025-01-02T00:00:00Z"
    }));
    vi.stubGlobal("fetch", fetchMock);
    const profile = await new PulseApiClient("https://example.test/")
      .link("employee-token", "employee-2");
    expect(profile.name).toBe("fallback@example.com");
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/employees/employee-2");
  });

  it("keeps the link when the optional manager lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({
        id: "employee-1",
        companyId: "company-1",
        userId: "user-1",
        firstName: "Ana",
        lastName: "Silva",
        email: "ana@example.com",
        position: "Designer",
        managerId: "missing",
        startDate: "2025-01-02T00:00:00Z"
      }))
      .mockResolvedValueOnce(response({ error: "not found" }, 404)));
    const profile = await new PulseApiClient("https://example.test").link("employee-token", "employee-1");
    expect(profile.managerName).toBeUndefined();
  });

  it("maps a missing scheduled question to null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "not found" }, 404)));
    await expect(new PulseApiClient("https://example.test").getQuestion("token", "employee-1"))
      .resolves.toBeNull();
  });

  it("derives leadership from active direct reports", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      employees: [
        { id: "employee-2", managerId: "employee-1", status: "active" },
        { id: "employee-3", managerId: "other", status: "active" }
      ],
      nextCursor: ""
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new PulseApiClient("https://example.test").hasDirectReports(
      "employee-token",
      "company-1",
      "employee-1"
    )).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/v1/employees/list?companyId=company-1&limit=500"
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("ignores inactive reports and stops after the final employee page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      employees: [
        { id: "employee-2", managerId: "employee-1", status: "inactive" }
      ],
      nextCursor: "0"
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new PulseApiClient("https://example.test").hasDirectReports(
      "employee-token",
      "company-1",
      "employee-1"
    )).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("continues leadership detection across employee pages", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        employees: [{ id: "employee-2", managerId: "other", status: "active" }],
        nextCursor: "page-2"
      }))
      .mockResolvedValueOnce(response({
        employees: [{ id: "employee-3", managerId: "employee-1", status: "active" }],
        nextCursor: ""
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new PulseApiClient("https://example.test").hasDirectReports(
      "employee-token",
      "company-1",
      "employee-1"
    )).resolves.toBe(true);
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=page-2");
  });

  it("maps the authoritative answer state from the Pulse service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      employeeId: "employee-1",
      date: "2026-07-24",
      answered: true,
      question: { id: "question-1", text: "Pergunta?", choices: [] }
    })));

    await expect(new PulseApiClient("https://example.test").getQuestion("token", "employee-1"))
      .resolves.toMatchObject({ answered: true, answerStatus: "external" });
  });

  it("keeps compatibility when the answer field is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      employeeId: "employee-1",
      date: "2026-07-24",
      question: { id: "question-1", text: "Pergunta?", choices: [] }
    })));

    await expect(new PulseApiClient("https://example.test").getQuestion("token", "employee-1"))
      .resolves.toMatchObject({ answered: false, answerStatus: "unanswered" });
  });

  it("submits the exact Pulse answer contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: "answer submitted successfully" }));
    vi.stubGlobal("fetch", fetchMock);
    await new PulseApiClient("https://example.test").submitAnswer("token", "employee-1", "question-1", "5");
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/pulse/answer/employee-1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ questionId: "question-1", value: "5" })
    });
  });

  it("returns and filters the official employee directory", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      employees: [
        {
          id: "2", firstName: "Zeca", lastName: "", email: "z@example.com",
          position: "Dev", status: "inactive", companyId: "c", userId: "u", startDate: ""
        },
        {
          id: "1", firstName: "Ana", lastName: "Lima", email: "a@example.com",
          position: "Design", status: " ACTIVE ", companyId: "c", userId: "u", startDate: ""
        },
        {
          id: "3", firstName: "Bruno", lastName: "Melo", email: "b@example.com",
          position: "PM", companyId: "c", userId: "u", startDate: ""
        }
      ]
    })));
    const employees = await new PulseApiClient("https://example.test").listEmployees("token", "c 1");
    expect(employees.map((employee) => employee.name)).toEqual(["Ana Lima", "Bruno Melo"]);
  });

  it("rejects an employee-directory request without a company ID", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(new PulseApiClient("https://example.test").listEmployees("token", " "))
      .rejects.toMatchObject({ code: "COMPANY_ID_MISSING", status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("follows employee pagination until nextCursor is exhausted", async () => {
    const employee = (id: string, name: string) => ({
      id,
      firstName: name,
      lastName: "Teste",
      email: `${id}@example.com`,
      position: "Analista",
      status: "active",
      companyId: "company",
      userId: `user-${id}`,
      startDate: ""
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ employees: [employee("1", "Ana")], nextCursor: 42 }))
      .mockResolvedValueOnce(response({ employees: [employee("2", "Bruno")], nextCursor: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    const employees = await new PulseApiClient("https://example.test").listEmployees("token", "company");
    expect(employees).toHaveLength(2);
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=42");
  });

  it("surfaces API errors without exposing response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "unauthorized" }, 401)));
    await expect(new PulseApiClient("https://example.test").listEmployees("token", "company"))
      .rejects.toEqual(new ApiError("unauthorized", 401, undefined));
  });

  it("uses the generic status message when an API error is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 })));
    await expect(new PulseApiClient("https://example.test").listEmployees("token", "company"))
      .rejects.toEqual(new ApiError("A API iTransform Pulse respondeu 502.", 502, undefined));
  });

  it("sends the exact structured feedback contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: "created", id: "feedback-1" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await new PulseApiClient("https://example.test").sendFeedback(
      {
        employeeId: "from",
        employeeToken: "employee-token",
        knowledgeToken: "knowledge-token",
        pulseToken: "pulse-token",
        expiresAt: "2026-07-24T20:00:00Z"
      },
      {
        id: "from", companyId: "company", userId: "user", name: "Ana",
        email: "ana@example.com", position: "Design", startDate: "2025-01-01"
      },
      {
        toEmployeeId: "to",
        method: "situational",
        importance: 5,
        content: {
          context: "  Na apresentação semanal.  ",
          observedBehavior: "  Explicou os riscos com dados.  ",
          perceivedImpact: "  A decisão ficou mais segura.  ",
          suggestedNextStep: "  Continue trazendo os dados antes da reunião.  ",
          continueDoing: "",
          startDoing: "",
          stopDoing: ""
        }
      }
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer pulse-token",
      "X-PulseTray-Employee-Token": "employee-token",
      "X-PulseTray-Knowledge-Token": "knowledge-token"
    });
    expect(body).toMatchObject({
      company_id: "company",
      from_employee_id: "from",
      to_employee_id: "to",
      method: "situational",
      value: "5",
      content: {
        context: "Na apresentação semanal.",
        observed_behavior: "Explicou os riscos com dados.",
        perceived_impact: "A decisão ficou mais segura.",
        suggested_next_step: "Continue trazendo os dados antes da reunião.",
        continue_doing: "",
        start_doing: "",
        stop_doing: ""
      }
    });
  });

  it("maps sent and received structured feedback history", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        feedbacks: [{
          id: "feedback-1",
          from_employee_id: "from",
          to_employee_id: "to",
          method: "development",
          value: "4",
          submitted_at: "2026-07-24T12:00:00Z",
          text: "Contexto: planejamento",
          content: {
            context: "Planejamento trimestral",
            continue_doing: "Antecipar riscos",
            start_doing: "Registrar decisões",
            stop_doing: ""
          },
          analysis: { status: "completed" }
        }]
      }))
      .mockResolvedValueOnce(response({
        employees: [{
          id: "to",
          firstName: "Bruno",
          lastName: "Melo",
          email: "bruno@example.com",
          position: "PM",
          status: "active",
          companyId: "company",
          userId: "user-to",
          startDate: ""
        }]
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new PulseApiClient("https://example.test").listFeedbackHistory(
      {
        employeeId: "from",
        employeeToken: "employee-token",
        knowledgeToken: "knowledge-token",
        pulseToken: "pulse-token",
        expiresAt: "2026-07-24T20:00:00Z"
      },
      {
        id: "from", companyId: "company", userId: "user", name: "Ana",
        email: "ana@example.com", position: "Design", startDate: "2025-01-01"
      },
      "sent"
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://example.test/v1/pulse/feedbacks/from?direction=sent"
    );
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer pulse-token",
      "X-PulseTray-Employee-Token": "employee-token"
    });
    expect(result.feedbacks).toEqual([
      expect.objectContaining({
        id: "feedback-1",
        person: "Bruno Melo",
        personEmail: "bruno@example.com",
        importance: 4,
        method: "development",
        analysisStatus: "completed",
        content: expect.objectContaining({
          context: "Planejamento trimestral",
          continueDoing: "Antecipar riscos",
          startDoing: "Registrar decisões"
        })
      })
    ]);
  });

  it("keeps feedback history available when employee hydration fails", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({
        feedbacks: [{
          id: "feedback-1",
          from_employee_id: "from",
          to_employee_id: "to",
          method: "situational",
          value: "5",
          submitted_at: "2026-07-24T12:00:00Z",
          text: "Contexto: reunião",
          content: { context: "Reunião" },
          analysis: { status: "queued" }
        }]
      }))
      .mockResolvedValueOnce(response({ error: "directory unavailable" }, 503)));

    const result = await new PulseApiClient("https://example.test").listFeedbackHistory(
      {
        employeeId: "from",
        employeeToken: "employee-token",
        knowledgeToken: "knowledge-token",
        pulseToken: "pulse-token",
        expiresAt: "2026-07-24T20:00:00Z"
      },
      {
        id: "from", companyId: "company", userId: "user", name: "Ana",
        email: "ana@example.com", position: "Design", startDate: "2025-01-01"
      },
      "sent"
    );

    expect(result.feedbacks).toEqual([
      expect.objectContaining({
        id: "feedback-1",
        person: "Colaborador",
        method: "situational",
        analysisStatus: "queued"
      })
    ]);
  });

  it("translates an invalid feedback target into an actionable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      response({ error: "invalid feedback target" }, 500)
    ));
    const request = new PulseApiClient("https://example.test").sendFeedback(
      {
        employeeId: "from",
        employeeToken: "employee-token",
        knowledgeToken: "knowledge-token",
        pulseToken: "pulse-token",
        expiresAt: "2026-07-24T20:00:00Z"
      },
      {
        id: "from", companyId: "company", userId: "user", name: "Ana",
        email: "ana@example.com", position: "Design", startDate: "2025-01-01"
      },
      {
        toEmployeeId: "to",
        method: "development",
        importance: 5,
        content: {
          context: "Planejamento trimestral",
          observedBehavior: "",
          perceivedImpact: "",
          suggestedNextStep: "",
          continueDoing: "Antecipar riscos",
          startDoing: "",
          stopDoing: ""
        }
      }
    );
    await expect(request).rejects.toThrow(
      "O colaborador selecionado não pôde ser validado. Atualize a lista e tente novamente."
    );
  });
});
