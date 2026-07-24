import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, SintoniaClient } from "./sintonia";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("SintoniaClient", () => {
  it("requests and exchanges the durable PulseTray token without an Authorization header", async () => {
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
    const client = new SintoniaClient("https://example.test");

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

    const profile = await new SintoniaClient("https://example.test").link("employee-token", "employee-1");
    expect(profile).toMatchObject({ id: "employee-1", name: "Ana Silva", managerName: "Caio Souza" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/employees/employee-1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toContain("Bearer ");
  });

  it("rejects a session without an employee ID", async () => {
    await expect(new SintoniaClient().link("employee-token", undefined)).rejects.toMatchObject({
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
    const profile = await new SintoniaClient("https://example.test/")
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
    const profile = await new SintoniaClient("https://example.test").link("employee-token", "employee-1");
    expect(profile.managerName).toBeUndefined();
  });

  it("maps a missing scheduled question to null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "not found" }, 404)));
    await expect(new SintoniaClient("https://example.test").getQuestion("token", "employee-1"))
      .resolves.toBeNull();
  });

  it("submits the exact Pulse answer contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: "answer submitted successfully" }));
    vi.stubGlobal("fetch", fetchMock);
    await new SintoniaClient("https://example.test").submitAnswer("token", "employee-1", "question-1", "5");
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
    const employees = await new SintoniaClient("https://example.test").listEmployees("token", "c 1");
    expect(employees.map((employee) => employee.name)).toEqual(["Ana Lima", "Bruno Melo"]);
  });

  it("rejects an employee-directory request without a company ID", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(new SintoniaClient("https://example.test").listEmployees("token", " "))
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
    const employees = await new SintoniaClient("https://example.test").listEmployees("token", "company");
    expect(employees).toHaveLength(2);
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=42");
  });

  it("builds feedback options only from IPT and IAT subdimensions", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({
        dimensions: [
          { id: "parent", indexId: "ipt", name: "Potencial" },
          { id: "child-1", indexId: "ipt", parentId: "parent", name: "Aprendizado" },
          { id: "child-2", indexId: "other", parentId: "parent", name: "Outro" }
        ]
      }))
      .mockResolvedValueOnce(response({
        indexes: [
          { id: "ipt", key: "IPT" },
          { id: "other", key: "OUTRO" }
        ]
      })));
    const dimensions = await new SintoniaClient("https://example.test")
      .listFeedbackDimensions("token", "company-1");
    expect(dimensions).toEqual([
      expect.objectContaining({ id: "child-1", indexKey: "IPT", name: "Aprendizado" })
    ]);
  });

  it("surfaces API errors without exposing response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "unauthorized" }, 401)));
    await expect(new SintoniaClient("https://example.test").listEmployees("token", "company"))
      .rejects.toEqual(new ApiError("unauthorized", 401, undefined));
  });

  it("uses the generic status message when an API error is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 })));
    await expect(new SintoniaClient("https://example.test").listEmployees("token", "company"))
      .rejects.toEqual(new ApiError("A API Sintonia respondeu 502.", 502, undefined));
  });

  it("sends the exact structured feedback contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: "created", id: "feedback-1" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await new SintoniaClient("https://example.test").sendFeedback(
      "token",
      {
        id: "from", companyId: "company", userId: "user", name: "Ana",
        email: "ana@example.com", position: "Design", startDate: "2025-01-01"
      },
      { toEmployeeId: "to", subDimensionId: "sub", importance: 5, message: "  Excelente trabalho.  " },
      { id: "sub", indexId: "ipt", indexKey: "IPT", parentId: "dimension", name: "Aprendizado" }
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      company_id: "company",
      from_employee_id: "from",
      to_employee_id: "to",
      dimension_id: "dimension",
      sub_dimension_id: "sub",
      index_id: "ipt",
      value: "5",
      text: "Excelente trabalho."
    });
    expect(body.submitted_at).toBeTruthy();
  });
});
