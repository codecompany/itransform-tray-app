import type { PulseTrayApi, SessionView } from "./contracts";

const configured: SessionView = {
  linked: true,
  configured: true,
  profile: {
    id: "employee-preview",
    companyId: "company-preview",
    userId: "user-preview",
    name: "Marina Costa",
    email: "marina@sintonia.example",
    position: "Product Designer",
    managerName: "Carlos Nunes",
    startDate: "2025-02-10T00:00:00Z"
  },
  dailyTime: "09:00",
  events: [
    {
      id: "event-1",
      kind: "system",
      title: "Pergunta diária disponível",
      detail: "A pergunta de hoje aguarda sua resposta.",
      at: new Date().toISOString()
    },
    {
      id: "event-2",
      kind: "feedback-sent",
      title: "Feedback enviado para Bruno Lima",
      detail: "IPT · Aprendizado · importância 5",
      at: new Date(Date.now() - 86_400_000).toISOString()
    }
  ],
  receivedFeedbackAvailable: true
};

export function installPreviewBridge(): void {
  const preview = new URLSearchParams(location.search).get("preview");
  let state: SessionView = preview === "token"
    ? { linked: false, configured: false, events: [], receivedFeedbackAvailable: false }
    : configured;
  window.pulseTray = {
    bootstrap: async () => state,
    requestAccess: async () => ({
      message: "Se o e-mail estiver vinculado a um colaborador ativo, o token será enviado em instantes."
    }),
    link: async () => {
      state = { ...configured, configured: false, dailyTime: undefined };
      return state;
    },
    saveDailyTime: async (time) => {
      state = { ...configured, dailyTime: time };
      return state;
    },
    getQuestion: async () => ({
      employeeId: "employee-preview",
      date: new Date().toISOString().slice(0, 10),
      answered: false,
      question: {
        id: "question-preview",
        text: "Sinto que tenho espaço para aprender e testar novas ideias no meu trabalho?",
        choices: [
          { value: "1", label: "Discordo totalmente" },
          { value: "2", label: "Discordo parcialmente" },
          { value: "3", label: "Nem concordo, nem discordo" },
          { value: "4", label: "Concordo parcialmente" },
          { value: "5", label: "Concordo totalmente" }
        ]
      }
    }),
    submitAnswer: async () => {
      state = { ...state, lastAnswerDate: new Date().toISOString().slice(0, 10) };
      return state;
    },
    listEmployees: async () => [
      { id: "employee-2", name: "Bruno Lima", email: "bruno@sintonia.example", position: "Engenheiro" },
      { id: "employee-3", name: "Camila Rocha", email: "camila@sintonia.example", position: "Analista" }
    ],
    listFeedbackTaxonomy: async () => ({
      indexes: [
        { id: "ipt", key: "IPT", description: "Índice de Potencial de Transformação" },
        { id: "iat", key: "IAT", description: "Índice de Ambiente de Trabalho" }
      ],
      dimensions: [
        { id: "dim-1", indexId: "ipt", indexKey: "IPT", name: "Potencial" },
        { id: "sub-1", indexId: "ipt", indexKey: "IPT", parentId: "dim-1", name: "Aprendizado" },
        { id: "dim-2", indexId: "iat", indexKey: "IAT", name: "Confiança" },
        { id: "sub-2", indexId: "iat", indexKey: "IAT", parentId: "dim-2", name: "Segurança psicológica" }
      ]
    }),
    sendFeedback: async () => undefined,
    listReceivedFeedback: async () => ({
      available: true,
      feedbacks: [{
        id: "feedback-1",
        sender: "Camila Rocha",
        date: new Date(Date.now() - 172_800_000).toISOString(),
        subDimension: "Confiança",
        importance: 4,
        message: "Sua condução tornou a conversa mais segura e objetiva."
      }]
    }),
    logout: async () => {
      state = { linked: false, configured: false, events: [], receivedFeedbackAvailable: false };
      return state;
    },
    onNavigate: () => () => undefined
  } satisfies PulseTrayApi;
}
