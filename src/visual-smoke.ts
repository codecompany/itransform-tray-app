function wait(milliseconds = 60): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitFor(selector: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
    await wait();
  }
  throw new Error(`Visual journey could not find ${selector}.`);
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Visual journey could not find button "${label}".`);
  return match;
}

async function click(label: string): Promise<void> {
  button(label).click();
  await wait();
}

async function fill(id: string, value: string): Promise<void> {
  const field = await waitFor(`#${id}`) as HTMLTextAreaElement | HTMLInputElement;
  const prototype = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await wait();
}

async function reachMethod(): Promise<void> {
  (await waitFor("#employee-option-employee-2")).click();
  await wait();
  await click("Próximo");
}

async function reachEvidence(): Promise<void> {
  await reachMethod();
  (await waitFor('[data-radio-value="situational"]')).click();
  await wait();
  await click("Próximo");
}

async function reachGuidance(): Promise<void> {
  await reachEvidence();
  await fill("feedback-context", "Na apresentação semanal ao cliente.");
  await fill("feedback-observedBehavior", "Apresentou os riscos antes de propor a solução.");
  await click("Próximo");
}

async function reachReview(): Promise<void> {
  await reachGuidance();
  await fill("feedback-perceivedImpact", "O time decidiu com mais segurança.");
  await fill("feedback-suggestedNextStep", "Continue compartilhando os riscos antes da reunião.");
  await click("Próximo");
  (await waitFor('[data-radio-value="4"]')).click();
  await wait();
}

export async function prepareVisualJourney(journey: string): Promise<void> {
  switch (journey) {
    case "method":
      await reachMethod();
      break;
    case "evidence":
      await reachEvidence();
      break;
    case "guidance":
      await reachGuidance();
      break;
    case "review":
      await reachReview();
      break;
    case "success":
      await reachReview();
      await click("Concluir envio");
      await waitFor(".success-card");
      break;
    case "received":
      await click("Recebidos");
      await waitFor(".feedback-history");
      break;
    case "settings":
      document.querySelector<HTMLButtonElement>('button[aria-label="Ajustes"]')?.click();
      await waitFor(".settings-form");
      break;
    default:
      break;
  }
}
