import type { UnsubscribeFunc } from "home-assistant-js-websocket";
import type { HomeAssistant } from "../ha/types";

/** True if a config string is a Jinja template rather than a literal. */
export function isTemplate(value: string | undefined): value is string {
  return !!value && (value.includes("{{") || value.includes("{%"));
}

interface RenderTemplateResult {
  result: unknown;
}

/**
 * Keeps one live `render_template` subscription per template string and
 * stores the latest rendered result. Call `sync()` with the templates that
 * are currently needed; it subscribes to new ones and drops stale ones, so
 * it is cheap to call often.
 */
export class TemplateSubscriber {
  /** Latest rendered (trimmed) result for each template. */
  public results: Record<string, string | undefined> = {};

  private _subs = new Map<string, Promise<UnsubscribeFunc | undefined>>();

  constructor(private _onChange: () => void) {}

  public sync(hass: HomeAssistant, templates: string[]): void {
    const wanted = new Set(templates);
    for (const template of [...this._subs.keys()]) {
      if (!wanted.has(template)) {
        this._unsubscribe(template);
      }
    }
    for (const template of wanted) {
      if (!this._subs.has(template)) {
        this._subscribe(hass, template);
      }
    }
  }

  public clear(): void {
    for (const template of [...this._subs.keys()]) {
      this._unsubscribe(template);
    }
  }

  private _subscribe(hass: HomeAssistant, template: string): void {
    const sub = hass.connection
      .subscribeMessage<RenderTemplateResult>(
        (msg) => {
          const result =
            msg.result === null || msg.result === undefined
              ? undefined
              : String(msg.result).trim() || undefined;
          if (this.results[template] !== result) {
            this.results = { ...this.results, [template]: result };
            this._onChange();
          }
        },
        { type: "render_template", template }
      )
      .catch((err) => {
        // Invalid template: keep the entry (so we don't retry on every
        // update) but leave the result empty, so the default colour is used.
        console.warn(
          `[energy-sankey] Template failed: ${template}`,
          err?.message ?? err
        );
        return undefined;
      });
    this._subs.set(template, sub);
  }

  private _unsubscribe(template: string): void {
    const sub = this._subs.get(template);
    this._subs.delete(template);
    const { [template]: _removed, ...rest } = this.results;
    this.results = rest;
    sub?.then((unsub) => unsub?.()).catch(() => undefined);
  }
}
