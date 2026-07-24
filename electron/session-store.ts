import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ActivityEvent,
  EmployeeProfile,
  QuietHoursWindow
} from "../src/contracts.js";
import type { AccessTokenBundle } from "./pulse-api.js";
import { normalizeQuietHours } from "./quiet-hours.js";
import {
  emptyDailyState,
  normalizeDailyState,
  type DailyState
} from "./question-state.js";

interface PersistedSession {
  tokenCipher?: string;
  tokensCipher?: string;
  dailyCipher?: string;
  preferencesCipher?: string;
  profile?: EmployeeProfile;
  events: ActivityEvent[];
  lastAnswerDate?: string;
  lastAnswerQuestionId?: string;
}

interface StoreEvent {
  kind: ActivityEvent["kind"];
  title: string;
  detail: string;
}

export interface SecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class SessionStore {
  private state: PersistedSession = { events: [] };
  private dailyState = emptyDailyState();
  private quietHoursState: QuietHoursWindow[] = [];

  constructor(
    private readonly file: string,
    private readonly secureStorage: SecureStorage
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      this.state = JSON.parse(raw) as PersistedSession;
      this.state.events ??= [];
      this.dailyState = this.loadDailyState();
      this.quietHoursState = this.loadQuietHours();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await this.clear();
      }
    }
  }

  snapshot(): Readonly<PersistedSession> {
    return this.state;
  }

  daily(): Readonly<DailyState> {
    return this.dailyState;
  }

  quietHours(): readonly QuietHoursWindow[] {
    return this.quietHoursState;
  }

  token(): string {
    if (!this.state.tokenCipher) throw new Error("Vincule seu token antes de continuar.");
    return this.decrypt(this.state.tokenCipher);
  }

  tokens(): AccessTokenBundle | undefined {
    if (!this.state.tokensCipher) return undefined;
    return JSON.parse(this.decrypt(this.state.tokensCipher)) as AccessTokenBundle;
  }

  async link(token: string, tokens: AccessTokenBundle, profile: EmployeeProfile): Promise<void> {
    this.assertEncryption();
    this.dailyState = emptyDailyState();
    this.quietHoursState = [];
    this.state = {
      tokenCipher: this.encrypt(token),
      tokensCipher: this.encrypt(JSON.stringify(tokens)),
      profile,
      events: []
    };
    this.event({
      kind: "system",
      title: "iTransform Pulse vinculado",
      detail: `Olá, ${profile.name}. Sua conta está pronta.`
    });
    await this.save();
  }

  async setTokens(tokens: AccessTokenBundle): Promise<void> {
    this.state.tokensCipher = this.encrypt(JSON.stringify(tokens));
    await this.save();
  }

  async setProfile(profile: EmployeeProfile): Promise<void> {
    this.state.profile = profile;
    await this.save();
  }

  async setDaily(next: DailyState, event?: StoreEvent): Promise<void> {
    this.dailyState = normalizeDailyState(next);
    if (event) this.event(event);
    await this.save();
  }

  async setQuietHours(windows: QuietHoursWindow[]): Promise<void> {
    this.quietHoursState = normalizeQuietHours(windows);
    await this.save();
  }

  async addEvent(kind: ActivityEvent["kind"], title: string, detail: string): Promise<void> {
    this.event({ kind, title, detail });
    await this.save();
  }

  async clear(): Promise<void> {
    this.state = { events: [] };
    this.dailyState = emptyDailyState();
    this.quietHoursState = [];
    await fs.rm(this.file, { force: true });
  }

  private loadDailyState(): DailyState {
    if (this.state.dailyCipher) {
      try {
        return normalizeDailyState(JSON.parse(this.decrypt(this.state.dailyCipher)));
      } catch {
        return emptyDailyState();
      }
    }
    const daily = emptyDailyState();
    daily.lastAnswerDate = this.state.lastAnswerDate;
    daily.lastAnswerQuestionId = this.state.lastAnswerQuestionId;
    daily.lastAnswerStatus = daily.lastAnswerDate ? "synced" : undefined;
    delete this.state.lastAnswerDate;
    delete this.state.lastAnswerQuestionId;
    return daily;
  }

  private event(input: StoreEvent): void {
    this.state.events.unshift({
      id: crypto.randomUUID(),
      ...input,
      at: new Date().toISOString()
    });
    this.state.events = this.state.events.slice(0, 200);
  }

  private loadQuietHours(): QuietHoursWindow[] {
    if (!this.state.preferencesCipher) return [];
    try {
      const preferences = JSON.parse(this.decrypt(this.state.preferencesCipher)) as {
        quietHours?: unknown;
      };
      return normalizeQuietHours(preferences.quietHours);
    } catch {
      return [];
    }
  }

  private async save(): Promise<void> {
    this.state.dailyCipher = this.encrypt(JSON.stringify(this.dailyState));
    this.state.preferencesCipher = this.encrypt(JSON.stringify({
      quietHours: this.quietHoursState
    }));
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.state), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, this.file);
  }

  private encrypt(value: string): string {
    this.assertEncryption();
    return this.secureStorage.encryptString(value).toString("base64");
  }

  private decrypt(value: string): string {
    this.assertEncryption();
    return this.secureStorage.decryptString(Buffer.from(value, "base64"));
  }

  private assertEncryption(): void {
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new Error("O armazenamento seguro do sistema não está disponível.");
    }
  }
}
