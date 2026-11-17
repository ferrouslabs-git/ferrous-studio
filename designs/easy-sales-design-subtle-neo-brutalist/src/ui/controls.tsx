// The design's controls. Every one works: state lives in memory and resets on
// reload. Nothing is saved or sent anywhere.
import {
  ButtonHTMLAttributes,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { usePageLink } from "../lib/nav";
import { Link } from "react-router-dom";
import { Icon, IconName } from "./icons";

/* ------------------------------------------------------------ buttons */

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "secondary",
  icon,
  size,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName; size?: "sm" }) {
  return (
    <button type="button" className={`btn btn-${variant}${size ? ` btn-${size}` : ""} ${className ?? ""}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------ page parts */

export function PageHeader({
  title,
  actions,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1>{title}</h1>
        {children}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

/** A horizontal navbar from the wireframe: tabs that are links to pages. */
export function Tabs({ items, label }: { items: { label: string; pageId: string }[]; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((item) => (
        <TabLink key={item.pageId + item.label} {...item} />
      ))}
    </nav>
  );
}

function TabLink({ label, pageId }: { label: string; pageId: string }) {
  const { href, active } = usePageLink(pageId);
  return (
    <Link to={href} className={`tab${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
      {label}
    </Link>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        <Icon name="file" size={20} />
      </div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ status */

const STATUS_TONE: Record<string, string> = {
  Active: "success",
  Paid: "success",
  Inactive: "neutral",
  Archived: "neutral",
  New: "accent",
  Invoiced: "warning",
};

/** Status shown with a dot AND its word, never colour alone. */
export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`status status-${STATUS_TONE[value] ?? "neutral"}`}>
      <span className="status-dot" aria-hidden="true" />
      {value}
    </span>
  );
}

export function Avatar({ name, size = 28, src }: { name: string; size?: number; src?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" loading="lazy" /> : initials}
    </span>
  );
}

/* ------------------------------------------------------------ fields */

export function Field({
  label,
  children,
  span = "full",
  error,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  span?: "full" | "half" | "third";
  error?: string;
  htmlFor?: string;
}) {
  return (
    <div className={`field field-${span}${error ? " has-error" : ""}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error && (
        <p className="field-error" role="alert">
          <Icon name="alert" size={14} />
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  type = "text",
  defaultValue,
  span,
  value,
  onChange,
  error,
  placeholder,
}: {
  label: string;
  type?: string;
  defaultValue?: string;
  span?: "full" | "half" | "third";
  value?: string;
  onChange?: (value: string) => void;
  error?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Field label={label} span={span} error={error} htmlFor={id}>
      <input
        id={id}
        className="input"
        type={type}
        defaultValue={value === undefined ? defaultValue : undefined}
        value={value}
        placeholder={placeholder}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        aria-invalid={!!error}
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  defaultValue,
  span,
}: {
  label: string;
  defaultValue?: string;
  span?: "full" | "half";
}) {
  const id = useId();
  return (
    <Field label={label} span={span} htmlFor={id}>
      <textarea id={id} className="input textarea" rows={3} defaultValue={defaultValue} />
    </Field>
  );
}

export function SelectField({
  label,
  options,
  defaultValue,
  span,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  defaultValue?: string;
  span?: "full" | "half" | "third";
  value?: string;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field label={label} span={span} htmlFor={id}>
      <Select id={id} options={options} defaultValue={defaultValue} value={value} onChange={onChange} />
    </Field>
  );
}

export function Select({
  options,
  defaultValue,
  value,
  onChange,
  id,
  ariaLabel,
  compact,
}: {
  options: string[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  id?: string;
  ariaLabel?: string;
  compact?: boolean;
}) {
  return (
    <span className={`select${compact ? " select-compact" : ""}`}>
      <select
        id={id}
        aria-label={ariaLabel}
        defaultValue={value === undefined ? defaultValue : undefined}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      <Icon name="chevron" size={14} className="select-chevron" />
    </span>
  );
}

export function CheckboxField({ label, defaultChecked }: { label: string; defaultChecked?: boolean }) {
  return (
    <label className="check check-field">
      <input type="checkbox" defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}

export function RadioGroupField({
  label,
  options,
  defaultValue,
  span,
}: {
  label: string;
  options: string[];
  defaultValue?: string;
  span?: "full" | "half";
}) {
  const name = useId();
  return (
    <fieldset className={`field field-${span ?? "full"} radio-group`}>
      <legend>{label}</legend>
      <div className="radio-options">
        {options.map((option) => (
          <label key={option} className="check">
            <input type="radio" name={name} value={option} defaultChecked={option === (defaultValue ?? options[0])} />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function DateField({
  label,
  defaultValue,
  span,
  withTime,
}: {
  label: string;
  defaultValue?: string;
  span?: "full" | "half" | "third";
  withTime?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} span={span} htmlFor={id}>
      <input id={id} className="input" type={withTime ? "datetime-local" : "date"} defaultValue={defaultValue} />
    </Field>
  );
}

/** A select of several values: the chosen ones show as chips. */
export function MultiSelectField({
  label,
  options,
  defaultValue = [],
  span,
}: {
  label: string;
  options: string[];
  defaultValue?: string[];
  span?: "full" | "half" | "third";
}) {
  const [chosen, setChosen] = useState<string[]>(defaultValue);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const toggle = (option: string) =>
    setChosen((current) => (current.includes(option) ? current.filter((x) => x !== option) : [...current, option]));
  return (
    <Field label={label} span={span} htmlFor={id}>
      <div className="multi" ref={box}>
        <button
          id={id}
          type="button"
          className="input multi-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((x) => !x)}
          onKeyDown={(event) => event.key === "Escape" && (event.stopPropagation(), setOpen(false))}
        >
          {chosen.length ? (
            <span className="chips">
              {chosen.map((value) => (
                <span key={value} className="chip">
                  {value}
                </span>
              ))}
            </span>
          ) : (
            <span className="placeholder">Choose…</span>
          )}
          <Icon name="chevron" size={14} />
        </button>
        {open && (
          <div className="menu" role="listbox" aria-multiselectable="true">
            {options.map((option) => (
              <label key={option} className="menu-item check">
                <input type="checkbox" checked={chosen.includes(option)} onChange={() => toggle(option)} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}

export function FileField({
  label,
  multiple,
  onFiles,
  accept,
}: {
  label: string;
  multiple?: boolean;
  onFiles?: (names: string[]) => void;
  accept?: string;
}) {
  const [names, setNames] = useState<string[]>([]);
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <label className="dropzone" htmlFor={id}>
        <Icon name="upload" size={18} />
        <span>
          <strong>Choose {multiple ? "files" : "a file"}</strong> or drop {multiple ? "them" : "it"} here
        </span>
        {!onFiles && names.length > 0 && <span className="dropzone-files">{names.join(", ")}</span>}
        <input
          id={id}
          type="file"
          multiple={multiple}
          accept={accept}
          className="visually-hidden"
          onChange={(event) => {
            const list = Array.from(event.target.files ?? []).map((file) => file.name);
            setNames(list);
            onFiles?.(list);
            event.target.value = "";
          }}
        />
      </label>
    </Field>
  );
}

export function SearchBox({
  value,
  onChange,
  label = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <label className="search">
      <Icon name="search" size={15} />
      <input
        type="search"
        placeholder="Search…"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/* ------------------------------------------------------------ toasts */

type Toast = { id: number; message: string; tone: "success" | "error" | "neutral" };
const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <Icon name={toast.tone === "error" ? "alert" : "check"} size={15} />
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
