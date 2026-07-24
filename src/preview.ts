import type { PulseTrayApi, SessionView } from "./contracts";

const configured: SessionView = {
  linked: true,
  configured: true,
  profile: {
    id: "employee-preview",
    companyId: "company-preview",
    userId: "user-preview",
    name: "Marina Costa",
    email: "marina@itransform.example",
    position: "Product Designer",
    managerName: "Carlos Nunes",
    startDate: "2025-02-10T00:00:00Z",
    isLeader: true
  },
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
      detail: "Situacional · importância 5",
      at: new Date(Date.now() - 86_400_000).toISOString()
    }
  ],
  receivedFeedbackAvailable: true,
  quietHours: [
    { start: "12:00", end: "13:00" },
    { start: "22:00", end: "07:00" }
  ]
};

export function installPreviewBridge(): void {
  const preview = new URLSearchParams(location.search).get("preview");
  let state: SessionView = preview === "token"
    ? {
        linked: false,
        configured: false,
        events: [],
        receivedFeedbackAvailable: false,
        quietHours: []
      }
    : configured;
  window.pulseTray = {
    bootstrap: async () => state,
    requestAccess: async () => ({
      message: "Se o e-mail estiver vinculado a um colaborador ativo, o token será enviado em instantes."
    }),
    link: async () => {
      state = configured;
      return state;
    },
    getQuestion: async () => ({
      employeeId: "employee-preview",
      date: new Date().toISOString().slice(0, 10),
      answered: false,
      answerStatus: "unanswered",
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
    skipQuestion: async () => state,
    listEmployees: async () => [
      { id: "employee-2", name: "Bruno Lima", email: "bruno@itransform.example", position: "Engenheiro" },
      { id: "employee-3", name: "Camila Rocha", email: "camila@itransform.example", position: "Analista" }
    ],
    sendFeedback: async () => configured,
    listFeedbackHistory: async (direction) => ({
      feedbacks: [{
        id: "feedback-1",
        person: direction === "sent" ? "Bruno Lima" : "Camila Rocha",
        date: new Date(Date.now() - 172_800_000).toISOString(),
        importance: 4,
        method: "situational",
        content: {
          context: "Durante a reunião de planejamento",
          observedBehavior: "Você organizou as decisões e confirmou os responsáveis.",
          perceivedImpact: "O time saiu com clareza sobre os próximos passos.",
          suggestedNextStep: "Continue reservando os minutos finais para esse resumo.",
          continueDoing: "",
          startDoing: "",
          stopDoing: ""
        },
        message: "Feedback situacional",
        analysisStatus: "completed"
      }]
    }),
    saveQuietHours: async (quietHours) => {
      state = { ...state, quietHours };
      return state;
    },
    openManagerHub: async () => undefined,
    openFeedbacks: async () => undefined,
    dismissQuestion: async () => undefined,
    logout: async () => {
      state = {
        linked: false,
        configured: false,
        events: [],
        receivedFeedbackAvailable: false,
        quietHours: []
      };
      return state;
    },
    onNavigate: (callback) => {
      if (preview === "question") queueMicrotask(() => callback("question", true));
      return () => undefined;
    }
  } satisfies PulseTrayApi;
}
