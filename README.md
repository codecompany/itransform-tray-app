# PulseTray

Aplicativo Electron compacto do Sintonia para a pergunta diária e feedbacks.
Ele permanece na área de notificação, inicia com o sistema e abre a pergunta
no horário escolhido pelo colaborador.

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
renderer: ficam protegidos pelo armazenamento nativo do sistema.

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

- `GET /v1/pulse/question/:employeeId`
- `POST /v1/pulse/answer/:employeeId`
- `POST /v1/pulse/feedbacks`
- `POST /v1/pulse/tray/access-requests`
- `POST /v1/pulse/tray/session`
- consultas autorizadas de colaboradores, índices e dimensões

O token opaco recebido por e-mail é trocado no Pulse Service por tokens oficiais
das audiências Employee, Knowledge e Pulse. A tela de recebidos continua
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
