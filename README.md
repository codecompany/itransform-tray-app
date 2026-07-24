# iTransform Pulse

Aplicativo Electron compacto da plataforma iTransform para a pergunta diária e feedbacks.
Ele permanece na área de notificação, inicia com o sistema e verifica a pergunta
no primeiro acesso e pela manhã. Quando disponível, abre a experiência em tela
cheia. O colaborador pode responder ou usar **Agora não**; nesse caso, uma
heurística local agenda uma nova tentativa mais tarde.

## Desenvolvimento

Requisitos: Node.js 20 ou mais recente.

```sh
npm ci
npm run dev
```

O processo principal lê `PULSETRAY_API_URL` e usa
`https://api.storifly.ai` por padrão. No primeiro acesso, o colaborador solicita
o token com o e-mail corporativo e recebe a credencial na própria caixa postal.
A credencial e os tokens oficiais de curta duração nunca são entregues ao
renderer: ficam protegidos pelo armazenamento nativo do sistema. A pergunta em
cache, os próximos horários e a fila de respostas também são criptografados no
processo principal e gravados por substituição atômica.

## Verificação

```sh
npm run typecheck
npm test -- --run
npm run test:coverage
npm run build
npm run dist:mac:dir
npm run check:workflows
npm run pack:dry-run
npm run smoke:npm
```

## Contratos consumidos

- `GET /v1/pulse/question/:employeeId` — inclui `answered`, a confirmação
  autoritativa de que qualquer canal já respondeu naquele dia.
- `POST /v1/pulse/answer/:employeeId` — preserva de forma idempotente somente a
  primeira resposta diária quando dois canais concorrem.
- `POST /v1/pulse/feedbacks`
- `POST /v1/pulse/tray/access-requests`
- `POST /v1/pulse/tray/session`
- `GET /v1/employees/list?companyId&cursor&limit`
- `GET /v1/indexes/list?companyId&cursor&limit`
- `GET /v1/dimensions/list?companyId&cursor&limit`

O token opaco recebido por e-mail é trocado no Pulse Service pelo Employee ID
revalidado e por tokens oficiais das audiências Employee, Knowledge e Pulse.
O processo principal usa esse ID para carregar o perfil e não interpreta claims
não contratados dos access tokens. No feedback, o colaborador é localizado
primeiro por nome ou e-mail; as subdimensões e os demais campos só aparecem
após uma seleção válida. Falhas no diretório e nas subdimensões podem ser
recuperadas de forma independente.

A pergunta diária não ocupa uma aba. Ela é aberta pelo agendador ou
manualmente pelo menu da área de notificação. Clicar no ícone do tray apenas
abre o menu; somente as ações de feedback e configurações abrem a janela
regular. Não existe configuração de
horário: um início interativo verifica imediatamente; uma inicialização oculta
antes das 09:00 aguarda a manhã. **Agora não** usa atrasos crescentes, com
jitter, persistidos localmente.

Ao responder, a seleção é salva primeiro na fila local e a interface confirma
sem depender da disponibilidade do servidor. A sincronização sempre consulta
`answered` antes de enviar. Falhas transitórias preservam a fila e usam backoff;
uma resposta encontrada no Slack ou no e-mail encerra o item local sem
sobrescrever o servidor. Lembretes e confirmações são notificações nativas do
sistema, com texto genérico e sem conteúdo do feedback.
A tela de recebidos continua
apresentando indisponibilidade explícita enquanto não existir um contrato
autorizado para esse histórico. Nenhuma rota alternativa, acesso a banco,
datalake ou Manager Hub é utilizado.

## Distribuição

Tags `vX.Y.Z` e execuções manuais disparam a matriz macOS x64/arm64 e Windows
x64, assinatura/notarização quando os segredos estão configurados, checksums,
GitHub Release, publicação npm e instalação real de smoke test.

O pacote global contém apenas o instalador/launcher. Durante o `postinstall`,
ele baixa a versão portátil correspondente, valida o SHA-256 e troca o payload
local de forma atômica:

```sh
npm install -g @code-company/pulsetray
pulsetray --help
pulsetray --version
pulsetray
```
