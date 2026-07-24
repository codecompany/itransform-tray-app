# ADR-0001: Fronteiras seguras e distribuição do PulseTray

**Status:** Accepted  
**Date:** 2026-07-23  
**Deciders:** Equipe Sintonia

## Context

O PulseTray recebe um token de colaborador, executa em segundo plano e abre uma
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
- A janela obrigatória continua ativa após tentativas de fechamento.
- Novas operações precisam de canal IPC explícito e validação no processo
  principal.
- Feedbacks recebidos só podem ser liberados quando houver uma rota oficial
  autorizada para o colaborador.

## Action Items

1. Manter o teste de contrato entre a resposta de sessão e a vinculação pelo
   Employee ID.
2. Disponibilizar a rota oficial de feedbacks recebidos/notificações.
