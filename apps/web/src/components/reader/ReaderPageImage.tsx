import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

interface Props {
  src: string;
  alt: string;
  containerClassName?: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
  onLoad?: () => void;
  onError?: () => void;
}

export function ReaderPageImage({
  src,
  alt,
  containerClassName,
  imgClassName,
  loading = "lazy",
  fetchPriority = "auto",
  onLoad,
  onError,
}: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setStatus("loading");
    setAttempt(0);
  }, [src]);

  const retrySrc = useMemo(() => (attempt > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src), [src, attempt]);

  return (
    <div className={clsx("relative", containerClassName)}>
      <img
        src={retrySrc}
        alt={alt}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
        draggable={false}
        className={clsx(
          "h-full w-full object-contain transition-opacity duration-150",
          imgClassName,
          status === "loading" && "opacity-0",
          status === "error" && "opacity-30",
        )}
        onLoad={() => {
          setStatus("ready");
          onLoad?.();
        }}
        onError={() => {
          if (attempt < 1) {
            setAttempt((n) => n + 1);
            return;
          }
          setStatus("error");
          onError?.();
        }}
      />
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-2 rounded-full bg-ink-900/70 px-4 py-2 text-xs font-medium text-ink-200 shadow-lg backdrop-blur">
            <span
              aria-hidden
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent"
            />
            Cargando página…
          </div>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center pointer-events-none">
          <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-100">
            Página no disponible
          </div>
        </div>
      )}
    </div>
  );
}
