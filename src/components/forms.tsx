"use client";
import { useState, useRef, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
export type Field = {
  name: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "password"
    | "textarea"
    | "number"
    | "checkbox"
    | "select"
    | "multi"
    | "datetime-local"
    | "file";
  required?: boolean;
  value?: string | number | boolean;
  options?: { value: string; label: string }[];
  selectedValues?: string[];
  nullable?: boolean;
  min?: number;
  max?: number;
  help?: string;
};
function DateTimeInput({ field }: { field: Field }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current && field.value) {
      const date = new Date(String(field.value));
      if (!Number.isNaN(date.getTime())) {
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
        ref.current.value = date.toISOString().slice(0, 16);
      }
    }
  }, [field.value]);
  return (
    <input
      ref={ref}
      type="datetime-local"
      name={field.name}
      required={field.required}
    />
  );
}
export async function request(path: string, body: unknown, key?: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message ?? data.message ?? "Не удалось выполнить действие",
    );
  return data.data ?? data;
}
export function ActionForm({
  endpoint,
  fields = [],
  defaults = {},
  label = "Сохранить",
  redirect,
  idempotent = false,
}: {
  endpoint: string;
  fields?: Field[];
  defaults?: Record<string, unknown>;
  label?: string;
  redirect?: string;
  idempotent?: boolean;
}) {
  const router = useRouter(),
    key = useRef<string>(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = event.currentTarget,
      fd = new FormData(form);
    try {
      if (!key.current) key.current = crypto.randomUUID();
      let result;
      if (fields.some((f) => f.type === "file")) {
        const r = await fetch(endpoint, { method: "POST", body: fd });
        const b = await r.json();
        if (!r.ok)
          throw new Error(b.error?.message ?? "Не удалось загрузить файл");
        result = b.data;
      } else {
        const body: Record<string, unknown> = { ...defaults };
        for (const field of fields) {
          const raw = fd.get(field.name);
          body[field.name] =
            field.type === "checkbox"
              ? raw === "on"
              : field.type === "multi"
                ? fd.getAll(field.name)
                : field.nullable && raw === ""
                  ? null
                  : field.type === "number"
                    ? Number(raw)
                    : field.type === "datetime-local"
                      ? new Date(String(raw)).toISOString()
                      : raw;
        }
        result = await request(
          endpoint,
          body,
          idempotent ? key.current : undefined,
        );
      }
      key.current = "";
      setMessage(
        result?.receipt
          ? `Заявка принята. Квитанция: ${result.receipt}`
          : result?.delivery
            ? "Приглашение поставлено в очередь локального почтового сервиса."
            : "Изменения сохранены.",
      );
      if (redirect) router.push(redirect);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="action-form">
      {fields.map((f) => (
        <label
          key={f.name}
          className={f.type === "checkbox" ? "check-field" : ""}
        >
          <span>{f.label}</span>
          {f.type === "textarea" ? (
            <textarea
              name={f.name}
              required={f.required}
              defaultValue={String(f.value ?? "")}
              rows={4}
              maxLength={50000}
            />
          ) : f.type === "select" ? (
            <select
              name={f.name}
              required={f.required}
              defaultValue={String(f.value ?? "")}
            >
              {f.options?.map((o) => (
                <option value={o.value} key={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "multi" ? (
            <select
              defaultValue={f.selectedValues ?? []}
              multiple
              name={f.name}
              required={f.required}
              size={Math.min(6, f.options?.length ?? 3)}
            >
              {f.options?.map((o) => (
                <option value={o.value} key={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "datetime-local" ? (
            <DateTimeInput field={f} />
          ) : (
            <input
              name={f.name}
              type={f.type ?? "text"}
              required={f.required}
              defaultValue={
                f.type === "checkbox" || f.type === "file"
                  ? undefined
                  : String(f.value ?? "")
              }
              defaultChecked={
                f.type === "checkbox" ? Boolean(f.value) : undefined
              }
              min={f.min}
              max={f.max}
              accept={
                f.type === "file"
                  ? "image/jpeg,image/png,image/webp"
                  : undefined
              }
            />
          )}
          {f.help && <small>{f.help}</small>}
        </label>
      ))}
      <button type="submit" disabled={busy}>
        {busy ? "Выполняется…" : label}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
export function AuthForm({ mode, token }: { mode: string; token?: string }) {
  const router = useRouter(),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [otp, setOtp] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(event.currentTarget);
    try {
      if (otp) {
        await request("/api/auth/two-factor/verify-totp", {
          code: f.get("code"),
          trustDevice: false,
        });
        router.push("/dashboard");
        router.refresh();
        return;
      }
      if (mode === "sign-in") {
        const r = await request("/api/auth/sign-in/email", {
          email: f.get("email"),
          password: f.get("password"),
        });
        if (r.twoFactorRedirect) {
          setOtp(true);
          return;
        }
        router.push("/dashboard");
        router.refresh();
      } else if (mode === "sign-up") {
        await request("/api/auth/sign-up/email", {
          name: f.get("name"),
          email: f.get("email"),
          password: f.get("password"),
          consentsAccepted: true,
          callbackURL: location.origin + "/onboarding",
        });
        setMessage(
          "Аккаунт создан. Подтвердите email по письму. В локальном режиме письмо находится в Mailpit.",
        );
      } else if (mode === "forgot-password") {
        await request("/api/auth/request-password-reset", {
          email: f.get("email"),
          redirectTo: location.origin + "/reset-password",
        });
        setMessage(
          "Если аккаунт существует, инструкция поставлена в почтовую очередь.",
        );
      } else {
        await request("/api/auth/reset-password", {
          token,
          newPassword: f.get("password"),
        });
        setMessage("Пароль изменён. Можно войти.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка авторизации");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="action-form">
      {otp ? (
        <label>
          Код приложения-аутентификатора
          <input
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
          />
        </label>
      ) : (
        <>
          {mode === "sign-up" && (
            <label>
              Как к вам обращаться
              <input name="name" required maxLength={150} autoComplete="name" />
            </label>
          )}
          {mode !== "reset-password" && (
            <label>
              Email
              <input name="email" type="email" required autoComplete="email" />
            </label>
          )}
          {mode !== "forgot-password" && (
            <label>
              Пароль
              <input
                aria-label="Пароль"
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete={
                  mode === "sign-in" ? "current-password" : "new-password"
                }
              />
              <small>Не менее 12 символов</small>
            </label>
          )}
          {mode === "sign-up" && (
            <label className="check-field">
              <span>
                Я ознакомился с проектом условий и согласен на обработку данных
                в тестовой среде
              </span>
              <input type="checkbox" required />
            </label>
          )}
        </>
      )}
      <button disabled={busy}>
        {busy
          ? "Подождите…"
          : otp
            ? "Подтвердить код"
            : mode === "sign-in"
              ? "Войти"
              : mode === "sign-up"
                ? "Создать аккаунт"
                : mode === "forgot-password"
                  ? "Получить инструкцию"
                  : "Изменить пароль"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
    </form>
  );
}
export function SignOut() {
  const router = useRouter();
  return (
    <button
      className="text-button"
      onClick={async () => {
        await request("/api/auth/sign-out", {});
        router.push("/");
        router.refresh();
      }}
    >
      Выйти
    </button>
  );
}
export function MfaSetup() {
  const [uri, setUri] = useState(""),
    [codes, setCodes] = useState<string[]>([]),
    [error, setError] = useState("");
  return (
    <section>
      <h2>Двухфакторная защита</h2>
      <p>
        Для сотрудников обязательна. Добавьте секрет в ваше
        приложение-аутентификатор и подтвердите код.
      </p>
      <form
        className="action-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await request("/api/auth/two-factor/enable", {
              password: new FormData(e.currentTarget).get("password"),
            });
            setUri(r.totpURI);
            setCodes(r.backupCodes);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label>
          Текущий пароль
          <input name="password" type="password" required />
        </label>
        <button>Настроить 2FA</button>
      </form>
      {uri && (
        <>
          <p className="break">
            Ссылка настройки: <code>{uri}</code>
          </p>
          <p>Сохраните резервные коды в надёжном месте:</p>
          <code className="break">{codes.join(" · ")}</code>
          <ActionForm
            endpoint="/api/auth/two-factor/verify-totp"
            fields={[{ name: "code", label: "Код приложения", required: true }]}
            label="Подтвердить 2FA"
          />
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
