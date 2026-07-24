# ADR-0001: Fronteiras seguras e distribuição do iTransform Pulse

**Status:** Accepted  
**Date:** 2026-07-23  
**Updated:** 2026-07-24
**Deciders:** Equipe iTransform

## Context

O iTransform Pulse recebe um token de colaborador, executa em segundo plano e abre uma
janela diária obrigatória. O renderer não deve obter credenciais, módulos Node
ou acesso direto a serviços internos. A distribuição também precisa oferecer
instaladores tradicionais e um pacote npm pequeno, sem incorporar outro
Electron no pacote.

## Decision

- O processo principal controla sessão, APIs, agendamento, tray e ciclo das
  janelas.
- O preload expõe somente operações tipadas e específicas por `contextBridge`.
- O renderer permanece web puro, com `contextIsolation`, sandbox e CSP.
- O token é criptografado com o armazenamento seguro do sistema e nunca aparece
  em logs ou respostas IPC.
- A sessão do Pulse Service fornece o Employee ID revalidado. O processo
  principal usa esse ID para carregar o perfil e não interpreta claims dos
  access tokens.
- Toda integração usa APIs oficiais. Contratos ausentes permanecem indisponíveis
  de forma explícita.
- A pergunta diária não faz parte da navegação persistente. Quando o agendador
  encontra uma pergunta disponível, o processo principal abre uma janela em
  separado, sem barra de título, com tamanho fixo e sem redimensionamento. O
  colaborador pode responder ou adiá-la; o processo principal controla a
  próxima tentativa. O menu do tray mantém um acesso manual à mesma experiência.
- Janelas de silêncio locais e criptografadas substituem qualquer configuração
  de horário preferido. Durante esses intervalos a pergunta continua sendo
  validada, mas o popup é adiado até o fim do período.
- O diretório de colaboradores é consultado antes do compositor. O renderer só
  revela o método e os campos guiados depois da seleção de um nome ou e-mail
  retornado pela API oficial. Índice e dimensões não são escolhidos pelo
  colaborador; a classificação ocorre de forma assíncrona no backend.
- Lembretes e confirmações são enviados pelo sistema operacional. O conteúdo
  nativo é genérico e não contém token, nome, e-mail ou mensagem de feedback.
- Clicar no ícone do tray abre somente o menu nativo. Apenas ações explícitas
  de Feedbacks ou Ajustes abrem a janela regular; a questão diária
  mantém sua ação manual e seu disparo automático.
- Feedbacks enviados e recebidos usam uma única área com abas. A liderança é
  derivada da existência de colaboradores ativos com `managerId` igual ao
  usuário atual; somente nesse caso o renderer exibe ManagerHub, que abre
  `https://itransform.cc` pelo processo principal.
- O macOS recebe uma imagem Template monocromática com fundo transparente.
  O sistema operacional aplica o contraste correto para cada aparência.
- Interfaces, notificações e metadados de aplicativo usam o nome
  `iTransform Pulse`. O pacote npm, o comando `pulsetray`, as variáveis
  `PULSETRAY_*` e os headers `X-PulseTray-*` permanecem estáveis como
  identificadores de compatibilidade.
- O processo principal mantém o diretório técnico de dados da versão anterior
  para preservar a sessão criptografada, a resposta pendente e a heurística de
  lembrete durante a atualização.
- O pacote npm baixa o artefato portátil da mesma versão, valida o SHA-256 e
  instala por troca atômica.

## Options Considered

| Opção | Complexidade | Segurança | Aderência às referências |
|---|---:|---:|---:|
| APIs no processo principal e IPC estreito | Média | Alta | Alta |
| Chamadas HTTP e token no renderer | Baixa | Baixa | Baixa |
| Electron completo dentro do pacote npm | Baixa | Média | Baixa |

## Trade-off Analysis

O processo principal concentra mais coordenação, mas reduz a superfície exposta
e permite impor o comportamento da janela diária no nível nativo. O download no
`postinstall` depende da disponibilidade da GitHub Release, compensada por
checksum, staging e substituição atômica.

## Consequences

- APIs e credenciais ficam fora do contexto DOM.
- A vinculação não depende de e-mail ou Employee ID dentro do JWT de Employee.
- A janela obrigatória não pode ser fechada nem redimensionada, exceto quando o
  colaborador responde ou escolhe adiá-la.
- A resposta é considerada aceita pela interface depois da gravação local
  criptografada; a confirmação do servidor ocorre em segundo plano.
- O histórico interno não é apresentado como uma central de notificações; o
  usuário recebe os avisos pelo mecanismo nativo do sistema.
- Novas operações precisam de canal IPC explícito e validação no processo
  principal.
- Feedbacks enviados e recebidos usam a rota oficial autorizada para o
  colaborador e ficam em abas separadas do compositor.

## Action Items

1. Manter o teste de contrato entre a resposta de sessão e a vinculação pelo
   Employee ID.
2. Manter testes de contrato para os históricos enviados e recebidos.
